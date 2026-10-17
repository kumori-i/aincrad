// A single fresh discovery actor joins the unsaved Ozark walking pilot. The
// binding is runtime-only; no historical valley save is opened or rewritten.
import { createNpc } from './npc-state.js';
import { NpcController } from './controller.js';
import { createEnvironment, tickEnvironment } from './environment.js';
import { bindOzarkAgentWorld } from './ozark-agent-world.js';

// This dry bank and seed make the first generic exploration choice a reachable
// river tile in the deterministic pilot. Neither supplies a destination.
export const OZARK_AGENT_BANK = Object.freeze({ x: -1200, y: 400 });
export const OZARK_AGENT_SEED = 6;

export function createOzarkWadingAgentSession(geometry, {
  position = OZARK_AGENT_BANK, seed = OZARK_AGENT_SEED,
} = {}) {
  const npc = createNpc({ id: 'aster', mode: 'discovery', seed });
  bindOzarkAgentWorld(npc, geometry, { position });
  const environment = createEnvironment(seed, { mode: 'discovery', populate: false });
  const controller = new NpcController(npc, { environment });
  return {
    npc, environment, controller,
    tick(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > .25) throw new RangeError('Expected a positive bounded pilot step');
      tickEnvironment(environment, dt);
      controller.tick(dt);
      return npc;
    },
    dispose() { controller.dispose(); },
  };
}
