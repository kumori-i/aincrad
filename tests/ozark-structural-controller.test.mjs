import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry, OZARK_WORLD_PROFILE } from '../src/ozark-world-geometry.js';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction } from '../src/npc.js';
import { NpcController } from '../src/controller.js';

test('predeclared isolated controller scenes retain failures but do not remain in the physical lock', t => {
  // These two starts, seed, initial commands and 25-second duration were fixed
  // before the physics correction. Empty ecology isolates locomotion. This is
  // not a broad recovery-learning, survival or actual-user-save trial.
  const geometry = createOzarkWorldGeometry();
  for (const from of [{ x: 240, y: 3120 }, { x: 320, y: 3120 }]) {
    const actor = createNpc({ id: 'aster', mode: 'discovery', seed: 1 });
    actor.position = { ...from };
    const environment = createEnvironment(1, { mode: 'discovery', populate: false });
    environment.ecology = { plants: [], animals: [], materials: [] };
    bindOzarkWorldAgent(actor, geometry, {
      geometryIdentity: OZARK_WORLD_PROFILE.identity, agents: [actor],
    });
    observeNpc(actor, environment);
    const controller = new NpcController(actor, { environment });
    try {
      assert.equal(requestNpcAction(actor, { type: 'move',
        target: { x: from.x, y: from.y + 80 } }, environment).code, 'STARTED');
      for (let index = 0; index < 1500; index++) controller.tick(CONFIG.fixedStep);
      const actions = actor.memory.experience.filter(event => event.type === 'action');
      const failures = actions.filter(event => event.details.result.ok === false);
      const arrivals = actions.filter(event => event.details.result.code === 'ARRIVED' && event.details.action.duration !== .75);
      const recoveries = actions.filter(event => event.details.result.code === 'ARRIVED' && event.details.action.duration === .75);
      assert.ok(failures.length > 0, 'route and climb failures remain real evidence');
      assert.ok(arrivals.length > 0);
      assert.equal(geometry.canOccupy(actor.position.x, actor.position.y), true);
      if (from.x === 240) {
        assert.equal(actions[0].details.result.code, 'ROUTE_BLOCKED');
        assert.ok(arrivals.some(event => event.at > failures[0].at),
          'ordinary goals, not retreat receipts, remain reachable after failure');
        // Recovery intentionally changes subsequent policy choices. The exact
        // (0,3200) route remains a separate paid traversal control in movement-recovery.test.mjs.
      } else {
        const oldLock = { x: 527.9482587463335, y: 3120.0000031694867 };
        assert.ok(Math.hypot(actor.position.x - oldLock.x, actor.position.y - oldLock.y) > 100);
        assert.ok(arrivals.some(event => event.at > failures[0].at),
          'this fixed trial can reach a later goal after experiencing failure');
      }
      t.diagnostic(JSON.stringify({ from, finalPosition: actor.position,
        failures: failures.length, ordinaryArrivals: arrivals.length, recoveryArrivals: recoveries.length, simulatedSeconds: actor.elapsed }));
    } finally {
      controller.dispose();
    }
  }
});
