// Deterministic, headless sensorimotor probe. Its assertions use only local
// observations and receipts from attempted actions, never the terrain sampler
// or collision policy. This is a scripted comparison, not learned behavior.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';
import { applyPilotMovement } from '../src/ozark-pilot-action-evidence.js';

const STEP = 1 / 60;

function guardStorage(operation) {
  const names = ['window', 'localStorage', 'sessionStorage', 'Storage',
    'indexedDB', 'aincradProfile'];
  const previous = new Map(names.map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const access = { reads: 0, writes: 0 };
  const blocked = name => {
    access.reads += 1;
    throw new Error(`Headless pilot accessed ${name}`);
  };
  try {
    for (const name of names) {
      assert.notEqual(previous.get(name)?.configurable, false,
        `Cannot guard ${name}`);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => blocked(name),
        set: () => {
          access.writes += 1;
          throw new Error(`Headless pilot wrote ${name}`);
        },
      });
    }
    const result = operation();
    assert.deepEqual(access, { reads: 0, writes: 0 });
    return { result, storageAccess: access };
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

function runScenario(geometry) {
  const fresh = () => ({ player: { ...geometry.spawn }, elapsed: 0,
    wetness: 0, effort: 0 });
  const takeSteps = (state, direction, count) => {
    const receipts = [];
    for (let step = 0; step < count; step += 1) {
      const { evidence } = applyPilotMovement(geometry, state, {
        dx: direction.x, dy: direction.y, dt: STEP,
      });
      assert.ok(evidence, 'every attempted move must produce a receipt');
      assert.equal(evidence.action.type, 'move');
      const length = Math.hypot(direction.x, direction.y);
      assert.deepEqual(evidence.action.direction, {
        x: direction.x / length, y: direction.y / length,
      });
      assert.equal(evidence.action.durationSeconds, STEP);
      assert.ok(Math.abs(evidence.at - evidence.startedAt - STEP) < 1e-9);
      if (receipts.length) assert.ok(evidence.startedAt >= receipts.at(-1).at);
      assert.deepEqual(evidence.result.displacement, {
        x: evidence.position.x - evidence.startPosition.x,
        y: evidence.position.y - evidence.startPosition.y,
      });
      receipts.push(evidence);
    }
    return receipts;
  };
  const progress = (receipts, direction) => {
    const first = receipts[0], last = receipts.at(-1);
    const length = Math.hypot(direction.x, direction.y);
    return ((last.position.x - first.startPosition.x) * direction.x +
      (last.position.y - first.startPosition.y) * direction.y) / length;
  };
  const prepareShallow = () => {
    const state = fresh();
    const bank = takeSteps(state, { x: -1, y: 0 }, 208);
    assert.equal(bank.at(-1).afterObservation.ground, 'dry-land');
    const entry = takeSteps(state, { x: 0, y: -1 }, 60);
    const transition = entry.find(row => row.beforeObservation.ground === 'dry-land' &&
      row.afterObservation.ground === 'shallow-water');
    assert.ok(transition, 'the northward attempt must enter shallow water');
    assert.equal(transition.result.wetness, 'wetter');
    assert.equal(entry.at(-1).afterObservation.currentCue, 'downstream');
    return { state, transition, entry };
  };

  const dryForward = takeSteps(fresh(), { x: 1, y: -1 }, 12);
  const dryReverse = takeSteps(fresh(), { x: -1, y: 1 }, 12);
  assert.ok(dryForward.every(row => row.afterObservation.ground === 'dry-land' &&
    row.result.wetness === 'steady'));
  assert.ok(dryReverse.every(row => row.afterObservation.ground === 'dry-land' &&
    row.result.wetness === 'steady'));
  const dryForwardProgress = progress(dryForward, { x: 1, y: -1 });
  const dryReverseProgress = progress(dryReverse, { x: -1, y: 1 });
  assert.ok(Math.abs(dryForwardProgress - dryReverseProgress) < 1e-7,
    'paired dry attempts should be symmetric');

  const withReach = prepareShallow();
  const againstReach = prepareShallow();
  const withFlow = takeSteps(withReach.state, { x: 1, y: -1 }, 12);
  const againstFlow = takeSteps(againstReach.state, { x: -1, y: 1 }, 12);
  assert.deepEqual(withFlow[0].startPosition, againstFlow[0].startPosition,
    'water comparisons must start from identical observed locations');
  assert.ok(withFlow.every(row => row.afterObservation.ground === 'shallow-water' &&
    row.result.wetness === 'wetter' && row.result.effort === 'rising'));
  assert.ok(againstFlow.every(row => row.afterObservation.ground === 'shallow-water' &&
    row.result.wetness === 'wetter' && row.result.effort === 'rising'));
  const withProgress = progress(withFlow, { x: 1, y: -1 });
  const againstProgress = progress(againstFlow, { x: -1, y: 1 });
  assert.ok(withProgress > againstProgress + 1,
    'one symmetric water attempt should be measurably assisted');
  assert.ok(againstProgress < dryReverseProgress,
    'opposed wading should make less progress than dry movement');
  assert.ok(withProgress < dryForwardProgress,
    'the authored wading slowdown should remain observable even with flow');

  const exitReach = prepareShallow();
  const exit = takeSteps(exitReach.state, { x: 0, y: 1 }, 100);
  const leaving = exit.find(row => row.beforeObservation.ground === 'shallow-water' &&
    row.afterObservation.ground === 'dry-land');
  assert.ok(leaving, 'a southward attempt must leave shallow water');
  assert.ok(exit.some(row => row.result.wetness === 'drying' &&
    row.result.effort === 'easing'), 'bodily recovery should be observed ashore');
  assert.equal(exit.at(-1).afterObservation.currentCue, null);

  const northernReach = prepareShallow();
  const north = takeSteps(northernReach.state, { x: 0, y: -1 }, 600);
  const lowProgress = north.find(row => row.result.code === 'NEGLIGIBLE_PROGRESS' &&
    row.afterObservation.ground === 'shallow-water' &&
    row.beforeObservation.nearby.some(seen =>
      seen.direction === 'north' && seen.ground === 'surface-water'));
  assert.ok(lowProgress,
    'northward attempts toward locally observed water must show little progress');
  assert.equal(lowProgress.result.resistance, 'strong');
  assert.equal(lowProgress.result.effort, 'rising');
  assert.equal(lowProgress.result.wetness, 'wetter');
  assert.ok(Math.hypot(lowProgress.result.displacement.x,
    lowProgress.result.displacement.y) > .05,
  'little forward progress can coexist with locally observed movement');
  assert.ok(north.every(row => row.afterObservation.ground !== 'surface-water'),
    'the actor must never enter the barred water');

  return {
    status: 'passed',
    scope: 'scripted local observations and action outcomes; no learning',
    dry: { forwardProgress: dryForwardProgress,
      reverseProgress: dryReverseProgress },
    wading: { assistedProgress: withProgress, opposedProgress: againstProgress,
      currentCue: withFlow[0].beforeObservation.currentCue },
    transitions: { entered: withReach.transition.afterObservation.ground,
      exited: leaving.afterObservation.ground },
    lowProgress: { code: lowProgress.result.code,
      resistance: lowProgress.result.resistance,
      position: lowProgress.position,
      displacement: lowProgress.result.displacement,
      effort: lowProgress.result.effort, wetness: lowProgress.result.wetness },
  };
}

export function runCausalProbe() {
  const { result, storageAccess } = guardStorage(() =>
    runScenario(createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE)));
  return Object.freeze({ ...result, storageAccess });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(runCausalProbe()));
}
