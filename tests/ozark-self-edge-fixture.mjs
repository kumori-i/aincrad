/** Shared synthetic physical fixture for headless and disposable native Ozark QA.
 * No saved/private run bytes are used, and the blocked edge and action receipt
 * are generated only by the authoritative movement action and fixed ticks. */
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { tickEnvironment } from '../src/environment.js';
import { tickOzarkEcology } from '../src/ozark-ecology.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { tileKey } from '../src/perception.js';
import { OZARK_SAVE_KEY, createOzarkState, writeOzarkSave } from '../src/ozark-save.js';

export const geometry = createOzarkWorldGeometry();
export const SAME_TILE_START = Object.freeze({
  x: 576.7451358360865, y: 2303.2548641639232,
});
export const SAME_TILE_TARGET = Object.freeze({ x: 640, y: 2400 });
export const HISTORICAL_BYTES = '{"protected":"historical world"}';

function storage() {
  const values = new Map([[CONFIG.saveKey, HISTORICAL_BYTES]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

export function blockedMove(from, target) {
  const state = createOzarkState(geometry), actor = state.agents[0];
  // A localized synthetic physical fixture, not a fresh survival replay. The
  // start is the first coarse-run self-edge's real location. No observations,
  // receipts, blocked edges or routes are imported from that run or fabricated.
  state.elapsed = state.environment.elapsed = 242.25;
  state.environment.ecology.elapsed = 242;
  state.environment.ecology.pending = .25;
  actor.position = { ...from };
  for (const agent of state.agents) {
    agent.elapsed = state.elapsed;
    bindOzarkWorldAgent(agent, geometry, state);
  }
  const disk = storage();
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'the physical fixture is valid before the movement attempt');
  const previousBytes = disk.getItem(OZARK_SAVE_KEY);
  const observation = observeNpc(actor, state.environment);
  assert.ok(observation.cells.some(cell => cell.key === tileKey(target)));
  assert.deepEqual(actor.memory.blockedEdges, {});
  assert.equal(requestNpcAction(actor, { type: 'move', target },
    state.environment).code, 'STARTED');
  const route = structuredClone(actor.active.route);
  let steps = 0;
  while (actor.active && steps < 120) {
    state.elapsed += CONFIG.fixedStep;
    tickEnvironment(state.environment, CONFIG.fixedStep);
    tickOzarkEcology(state.environment.ecology, CONFIG.fixedStep,
      state.environment, state.agents);
    for (const agent of state.agents)
      tickNpc(agent, CONFIG.fixedStep, state.environment);
    steps++;
  }
  assert.equal(actor.active, null, 'the native-tick action must terminate');
  const receipt = actor.memory.experience.find(event => event.type === 'action');
  assert.ok(receipt);
  assert.equal(receipt.details.result.code, 'ROUTE_BLOCKED');
  assert.equal(receipt.details.result.ok, false);
  assert.deepEqual(receipt.details.startPosition, from);
  assert.deepEqual(receipt.details.action, { type: 'move', target });
  assert.ok(Math.abs(receipt.details.result.durationSeconds -
    steps * CONFIG.fixedStep) < 1e-9,
    'fixture tick count and receipt duration agree within clock precision');
  return { state, actor, disk, previousBytes, route, receipt };
}

export function evidence(actor) {
  return structuredClone({
    position: actor.position, blockedEdges: actor.memory.blockedEdges,
    experience: actor.memory.experience, observations: actor.discovery.observations,
    experiments: actor.discovery.experiments, effects: actor.discovery.effects,
    seenFeedback: actor.discovery.seenFeedback, stomach: actor.physiology.stomach,
    feedback: actor.physiology.feedback, items: actor.inventory.items,
  });
}

export function syntheticOzarkSelfEdge() {
  const fixture = blockedMove(SAME_TILE_START, SAME_TILE_TARGET);
  const { state, actor, disk, receipt, route } = fixture;
  const edgeKey = '7,29>7,29';
  assert.equal(tileKey(SAME_TILE_START), tileKey(route[0]));
  assert.deepEqual(receipt.details.result.blockedTarget, route[0]);
  assert.equal(receipt.details.result.movement.traversal, 'adrift');
  assert.equal(receipt.details.result.movement.progress, 'negligible');
  assert.deepEqual(actor.memory.blockedEdges, {
    [edgeKey]: { observedAt: receipt.at, retryAfter: receipt.at + 60 },
  });
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'the real self-edge must pass the production save validator');
  return { raw: disk.getItem(OZARK_SAVE_KEY), edgeKey, receipt,
    actorEvidence: evidence(actor) };
}
