// One supported world contract: Ozark terrain, physical structures, bounded renewable fish.
// Incompatible historical slots are never read or rewritten by this runtime.
export const OZARK_CURRENT_WORLD_MODE = Object.freeze({
  version: 12,
  features: Object.freeze({ plantLifecycle: 1, finiteAquatic: 2, worldStructures: 1 }),
  finiteAquatic: true, worldStructures: true,
});
export function ozarkWorldMode(state) {
  const features = state?.features, expected = OZARK_CURRENT_WORLD_MODE.features;
  return state?.version === 12 && features && typeof features === 'object' &&
    !Array.isArray(features) && Reflect.ownKeys(features).length === 3 &&
    Object.keys(expected).every(key => Object.hasOwn(features,key) && features[key] === expected[key]) ?
    OZARK_CURRENT_WORLD_MODE : null;
}
export function ozarkGeometryMatchesMode(geometry, mode) {
  return mode === OZARK_CURRENT_WORLD_MODE && geometry?.structureVersion === 1 &&
    geometry?.structureContract === 'ozark-biome-structures-v1';
}
export function freshOzarkWorldMode(geometry) {
  return ozarkGeometryMatchesMode(geometry,OZARK_CURRENT_WORLD_MODE) ? OZARK_CURRENT_WORLD_MODE : null;
}
export function ozarkWorldCapabilityText(state) {
  if (!ozarkWorldMode(state)) return 'This save is protected. No capabilities or resources have been added.';
  return 'Aster and Mira can strike nearby animals, pull finite tissue from carcasses and sample held pieces. They can attempt shore catches from dry ground, then pull and sample the held fish. These are physical abilities, not guaranteed learned strategies. Fish keep moving and catches can fail. Local food supports feeding, growth and parent-funded offspring, but populations remain limited and extinction does not trigger respawns.';
}
