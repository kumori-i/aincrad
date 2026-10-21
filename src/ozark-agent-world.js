// The walking pilot can lend its physical world to one fresh discovery actor.
// This binding deliberately lives outside actor data and therefore cannot be
// mistaken for a saved-world identity or carried into a restored expedition.
import { OZARK_WORLD_PROFILE } from './ozark-world-geometry.js';
import { CONFIG, ENV_RULES } from './config.js';
import { ozarkWorldMode, ozarkGeometryMatchesMode } from './ozark-world-features.js';
import { aquaticEnabled } from './aquatic-state.js';
import { environmentConditions } from './environment.js';

const worlds = new WeakMap();
const persistentWorlds = new WeakSet();
const finiteAquaticWorlds = new WeakSet();

/**
 * Attach a validated fresh or restored actor to the separately identified
 * playable world. Binding is runtime-only: position, body, and learned evidence
 * must already have been validated by the world's save boundary. In particular,
 * reopening a world cannot turn an experienced actor into a fresh pilot actor.
 */
export function bindOzarkWorldAgent(npc, geometry, state) {
  if (state?.geometryIdentity !== OZARK_WORLD_PROFILE.identity ||
      !Array.isArray(state.agents) || !state.agents.includes(npc) ||
      !['aster', 'mira'].includes(npc?.id) || npc.mode !== 'discovery' ||
      npc.scene !== 'valley') {
    throw new TypeError('Ozark world binding requires its identified discovery actor');
  }
  if (geometry?.profile !== OZARK_WORLD_PROFILE ||
      typeof geometry.sample !== 'function' ||
      typeof geometry.classify !== 'function' ||
      typeof geometry.canOccupy !== 'function' ||
      typeof geometry.advance !== 'function' ||
      typeof geometry.lineOfSight !== 'function') {
    throw new TypeError('Expected the approved playable Ozark geometry');
  }
  if (!Number.isFinite(npc.position?.x) || !Number.isFinite(npc.position?.y) ||
      geometry.canOccupy(npc.position.x, npc.position.y, CONFIG.playerRadius) !== true) {
    throw new RangeError('Ozark actor position is not physically reachable');
  }
  const bound = worlds.get(npc);
  if (bound && bound !== geometry) throw new TypeError('Ozark agent is already bound to another physical world');
  worlds.set(npc, geometry);
  persistentWorlds.add(npc);
  // Engine-only capability. It conveys a supplied motor menu, never a target,
  // position, nutritional value, or recipe to the actor.
  const mode = ozarkWorldMode(state);
  if (mode?.finiteAquatic && ozarkGeometryMatchesMode(geometry, mode) &&
      aquaticEnabled(state.environment?.ecology)) finiteAquaticWorlds.add(npc);
  else finiteAquaticWorlds.delete(npc);
  return npc;
}

export function ozarkAgentWorld(npc) { return worlds.get(npc) || null; }
export function ozarkPersistentWorldAgent(npc) { return persistentWorlds.has(npc); }
export function ozarkFiniteAquaticAgent(npc) { return finiteAquaticWorlds.has(npc); }

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
  // The persistent world has its own local canopy climate. Only the unsaved
  // pilot lacks that ecology and still needs the legacy shade removed.
  if (ozarkPersistentWorldAgent(npc) && environment?.ecology?.ozarkEcologyVersion === 1) return sensed;
  if (!sensed.shade) return sensed;
  const shadeCooling = sensed.hour >= 7 && sensed.hour <= 19 ? ENV_RULES.shadeCooling : 0;
  return { ...sensed, shade: false, feltTemperature: sensed.feltTemperature + shadeCooling };
}
