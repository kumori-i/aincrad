// Harness-only assertions and commands; no application interface is added.
import assert from 'node:assert/strict';

export function assertStructuralPlayerStep(step, dx, distance, seconds = 1 / 60) {
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9,
    `${label}: ${actual} != ${expected}`);
  const { before, after } = step;
  assert.equal(step.footing, 'dry-ground');
  near(after.player.x - before.player.x, dx * distance, 'physical X displacement');
  near(after.player.y, before.player.y, 'physical Y unchanged');
  near(after.elapsed - before.elapsed, seconds, 'shared paid time');
  near(after.environmentElapsed - before.environmentElapsed, seconds, 'environment time');
  near(after.ecologyElapsed + after.ecologyPending - before.ecologyElapsed -
    before.ecologyPending, seconds, 'finite ecology paid time');
  near(after.distance - before.distance, distance, 'recorded physical distance');
  assert.ok(before.playerBody.stamina > 1 && before.playerBody.effort < .9);
  near(before.playerBody.stamina - after.playerBody.stamina, seconds * 2.4, 'paid stamina');
  near(after.playerBody.effort - before.playerBody.effort, seconds * .04, 'paid effort');
  for (const actor of before.agents) {
    const next = after.agents.find(row => row.id === actor.id);
    assert.ok(next);
    near(next.elapsed - actor.elapsed, seconds, 'agent time: ' + actor.id);
  }
}

export function assertStructuralRestoredHistory(stored, actual) {
  assert.equal(actual.elapsed, stored.elapsed);
  assert.deepEqual(actual.clocks, { environmentElapsed: stored.environment.elapsed,
    ecologyElapsed: stored.environment.ecology.elapsed,
    ecologyPending: stored.environment.ecology.pending });
  assert.deepEqual(actual.player, stored.player);
  assert.deepEqual(actual.playerBody, stored.playerBody);
  for (const prior of stored.agents) {
    const next = actual.agents.find(row => row.id === prior.id);
    assert.ok(next);
    assert.deepEqual(next.position, prior.position);
    assert.equal(next.elapsed, prior.elapsed);
    assert.equal(next.active, null);
    const count = prior.memory.experience.length;
    assert.deepEqual(next.memory.experience.slice(0, count), prior.memory.experience,
      'Existing firsthand history must survive exactly');
    const extra = next.memory.experience.slice(count);
    assert.equal(extra.length, prior.interrupted ? 1 : 0);
    for (const receipt of extra) {
      assert.equal(receipt.type, 'action');
      assert.equal(receipt.details.result.code, 'RESTART_INTERRUPTED');
      assert.equal(receipt.details.result.ok, false, 'Restart cannot fabricate completion');
    }
  }
}

// This exact function is serialized into the sandboxed renderer. Existing QA
// step() calls the ordinary player/body/population engine and shared clock.
export async function runStructuralPlayerSteps(dx, count) {
  const q = window.__ozarkWorld;
  if (!q.snapshot().started || !q.snapshot().paused || ![-1, 1].includes(dx) ||
      !Number.isInteger(count) || count < 1 || count > 11) throw new Error('Invalid controlled movement phase');
  const { createOzarkWorldGeometry } = await import('./src/ozark-world-geometry.js');
  const geometry = createOzarkWorldGeometry();
  const evidence = () => {
    const state = q.fullSnapshot();
    return { player: state.player, playerBody: state.playerBody, elapsed: state.elapsed,
      distance: state.distance, environmentElapsed: state.environment.elapsed,
      ecologyElapsed: state.environment.ecology.elapsed,
      ecologyPending: state.environment.ecology.pending,
      agents: state.agents.map(actor => ({ id: actor.id, elapsed: actor.elapsed })) };
  };
  const steps = [];
  // No await, rendering frame or wall-clock tick may occur while unpaused.
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  try {
    if (q.snapshot().paused) throw new Error('Could not resume controlled movement');
    for (let index = 0; index < count; index++) {
      const before = evidence();
      if (!q.step(1 / 60, dx, 0, 'walk')) throw new Error('Ordinary movement step rejected');
      const after = evidence();
      steps.push({ before, after, footing: geometry.classify(after.player.x, after.player.y).reason });
    }
  } finally { q.pause(); }
  return steps;
}
