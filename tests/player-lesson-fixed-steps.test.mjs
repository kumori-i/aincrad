import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayerLessonFixedSteps } from '../scripts/player-lesson-fixed-steps.mjs';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { createPlayerLessonController } from '../src/player-lesson-action.js';

const step = CONFIG.fixedStep;

test('lesson driver emits integer full ticks and tolerates only representational duration error', () => {
  for (const seconds of [.1, .2, 1.8, .1 + Number.EPSILON, .1 - Number.EPSILON]) {
    const calls = [];
    assert.equal(advancePlayerLessonFixedSteps((...args) => { calls.push(args); return true; },
      step, seconds, .25, -.5, 'climb'), true);
    assert.equal(calls.length, Math.round(seconds / step));
    assert.ok(calls.every(args => args[0] === step));
    assert.ok(Math.abs(calls.length * step - seconds) <= Number.EPSILON * 8 * Math.max(1, seconds));
    assert.ok(calls.every(args => args[1] === .25 && args[2] === -.5 && args[3] === 'climb'));
  }
  let calls = 0;
  assert.equal(advancePlayerLessonFixedSteps(() => { calls++; return true; }, step, 0), true);
  assert.equal(calls, 0);
});

test('lesson driver rejects fractional durations before side effects and stops on a refused or thrown tick', () => {
  let calls = 0;
  const tick = () => { calls++; return true; };
  for (const seconds of [step / 2, 1.3877787807814457e-17, .1 + 1e-10, -1, NaN, Infinity, 31]) {
    assert.equal(advancePlayerLessonFixedSteps(tick, step, seconds), false);
    assert.equal(calls, 0);
  }
  assert.equal(advancePlayerLessonFixedSteps(tick, 0, .1), false);
  assert.equal(advancePlayerLessonFixedSteps(tick, step, .1, 2), false);
  assert.equal(advancePlayerLessonFixedSteps(tick, step, .1, 0, 0, 'invalid'), false);
  assert.equal(calls, 0);
  assert.equal(advancePlayerLessonFixedSteps(() => ++calls < 3, step, .1), false);
  assert.equal(calls, 3);
  const failure = new Error('native step failed');
  assert.throws(() => advancePlayerLessonFixedSteps(() => { throw failure; }, step, .1), error => error === failure);
});

// Real paid controller/parser and the native authored geometry. Only numeric
// sensor output is mocked here; native Canvas/capture remains a separate proof.
function lessonFixture() {
  const geometry = createOzarkWorldGeometry();
  const state = createOzarkState(geometry, { communicationSeed: 211 });
  state.player = { x: 276, y: 620 };
  const positions = {
    'object:671': { x: 180, y: 540 }, 'object:677': { x: 380, y: 620 },
    'object:679': { x: 140, y: 700 }, 'object:670': { x: 380, y: 730 },
  };
  for (const [id, position] of Object.entries(positions))
    state.environment.ecology.plants.find(plant => plant.id === id).position = position;
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  // Native typing/navigation already consumed ordinary time before the paid
  // action. At this nonzero clock magnitude the old subtraction tail is below
  // one representable world-time increment, matching the observed failure.
  state.elapsed = state.environment.elapsed = state.environment.ecology.elapsed = 1;
  for (const actor of state.agents) actor.elapsed = 1;
  const records = [];
  const controller = createPlayerLessonController({ state, geometry,
    pixelSensor: { captureVisible: actor => ({ at: actor.elapsed, epoch: actor.epoch,
      pixels: Array(768).fill(127), features: Array(48).fill(.2) }) },
    getLineage: () => state.worldLineage,
    onLessons: rows => records.push(...rows),
  });
  assert.equal(controller.start('nava', 'object:671').ok, true);
  let terminal = null;
  const tick = dt => {
    state.elapsed += dt;
    state.environment.elapsed = state.environment.ecology.elapsed = state.elapsed;
    for (const actor of state.agents) actor.elapsed = state.elapsed;
    terminal = controller.tickPaid(dt) || controller.observePaidStep() || terminal;
    return true;
  };
  return { state, controller, records, tick, result: () => terminal };
}

test('real lesson controller earns one example on full ticks but correctly censors an unfundable floating tail', () => {
  const normal = lessonFixture(), residual = lessonFixture(), batched = lessonFixture();
  try {
    for (let index = 0; index < 108; index++) {
      normal.tick(step);
      residual.tick(step);
      if (index === 5) {
        let elapsed = 0;
        for (let count = 0; count < 6; count++) elapsed += step;
        const tail = .1 - elapsed;
        assert.equal(tail, 1.3877787807814457e-17);
        const before = residual.state.elapsed;
        residual.tick(tail);
        assert.equal(residual.state.elapsed, before, 'The residual cannot advance representable world time');
        assert.equal(residual.controller.publicPose(), null, 'Unfunded time must not acquire a public pose');
      }
    }
    for (let batch = 0; batch < 18; batch++)
      assert.equal(advancePlayerLessonFixedSteps(batched.tick, step, .1), true);
    assert.equal(normal.result()?.code, 'POINT_COMPLETED');
    assert.equal(batched.result()?.code, 'POINT_COMPLETED');
    assert.equal(residual.result()?.code, 'POINT_COMPLETED_UNSEEN');
    assert.deepEqual(normal.records.map(row => row.agentId), ['aster']);
    assert.deepEqual(batched.records, normal.records);
    assert.deepEqual(residual.records, []);
    assert.equal(batched.state.elapsed, normal.state.elapsed);
  } finally {
    for (const fixture of [normal, residual, batched]) fixture.controller.dispose();
  }
});
