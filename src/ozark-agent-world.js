// The walking pilot can lend its physical world to one fresh discovery actor.
// This binding deliberately lives outside actor data and therefore cannot be
// mistaken for a saved-world identity or carried into a restored expedition.
import { OZARK_WALKING_PILOT_PROFILE } from './geometry-profile.js';
import { CONFIG, ENV_RULES } from './config.js';
import { environmentConditions } from './environment.js';

const worlds = new WeakMap();

export function bindOzarkAgentWorld(npc, geometry, { position = geometry?.spawn } = {}) {
  if (npc?.mode !== 'discovery' || npc.scene !== 'valley' || npc.elapsed !== 0 ||
      npc.active || npc.memory?.experience?.length || Object.keys(npc.memory?.cells || {}).length) {
    throw new TypeError('Ozark agent binding requires a fresh discovery actor');
  }
  if (geometry?.profile !== OZARK_WALKING_PILOT_PROFILE ||
      typeof geometry.classify !== 'function' ||
      typeof geometry.advance !== 'function' ||
      typeof geometry.lineOfSight !== 'function') {
    throw new TypeError('Expected the approved Ozark walking pilot geometry');
  }
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y) ||
      geometry.classify(position.x, position.y, CONFIG.playerRadius).reason !== 'dry-ground') {
    throw new RangeError('Ozark agent needs a dry reachable fresh spawn');
  }
  npc.position = { x: position.x, y: position.y };
  worlds.set(npc, geometry);
  return npc;
}

export function ozarkAgentWorld(npc) { return worlds.get(npc) || null; }

export function ozarkAgentLineOfSight(npc, from, to) {
  const geometry = ozarkAgentWorld(npc);
  return geometry ? geometry.lineOfSight(from, to) : null;
}

// Weather still comes from the isolated clock. Legacy valley trees cannot
// supply shade or a temperature benefit to an actor in the Ozark pilot.
export function ozarkAgentSensation(npc, environment) {
  const sensed = environmentConditions(environment, {
    position: npc.position, scene: npc.scene, wetness: npc.thermal.wetness,
  });
  if (!sensed.shade) return sensed;
  const shadeCooling = sensed.hour >= 7 && sensed.hour <= 19 ? ENV_RULES.shadeCooling : 0;
  return { ...sensed, shade: false, feltTemperature: sensed.feltTemperature + shadeCooling };
}
