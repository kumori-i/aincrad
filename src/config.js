/** World distances are in logical pixels. Change rules here, never in the renderer. */
export const CONFIG = Object.freeze({
  title: 'Aincrad', version: '0.5.0', seed: 74193,
  halfSize: 24000, valleyRadius: 22500, walkSpeed: 150, sprintMultiplier: 1.65,
  playerRadius: 10, fixedStep: 1 / 60, chunkSize: 640, treeCell: 145,
  dayRealSeconds: 3600, // One in-game day = one hour of unpaused play.
  startHour: 8, saveKey: 'aincrad.save.v1', maxCachedChunks: 48,
});
export const SPAWN = Object.freeze({ x: -680, y: 380 });
/** A dry bank, exposed through ordinary local observation rather than a preloaded map. */
export const STARTER_NPC_SPAWN = Object.freeze({ x: 276, y: 760 });
export const SECOND_NPC_SPAWN = Object.freeze({ x: 300, y: 920 });
export const PONDS = Object.freeze([
  { id: 'spring', name: 'Trailhead Pond', x: 480, y: 760, rx: 170, ry: 125 },
  { id: 'meadow', name: 'Sunfall Pool', x: 5100, y: 4800, rx: 145, ry: 115 },
  { id: 'oldwood', name: 'Oldwood Pool', x: -10500, y: 7400, rx: 190, ry: 145 },
  { id: 'north', name: 'Heather Pond', x: 8800, y: -7200, rx: 160, ry: 120 },
  { id: 'west', name: 'Fern Pool', x: -14200, y: -2500, rx: 135, ry: 110 },
  { id: 'south', name: 'Reed Pond', x: 11900, y: 14800, rx: 175, ry: 130 },
]);
export const APPLE_PATCHES = Object.freeze([
  { id: 'trail-orchard', name: 'Trailhead Apples', x: 880, y: 700, capacity: 3 },
  { id: 'mint-grove', name: 'Meadow Apples', x: 460, y: 1360, capacity: 3 },
  { id: 'hill-apples', name: 'Hillside Apples', x: 1750, y: 1050, capacity: 4 },
  { id: 'shelter-orchard', name: 'Refuge Apples', x: 2680, y: 1840, capacity: 3 },
  { id: 'sunfall', name: 'Sunfall Apples', x: 5550, y: 5110, capacity: 3 },
  { id: 'oldwood', name: 'Oldwood Apples', x: -10200, y: 7780, capacity: 4 },
  { id: 'heather', name: 'Heather Apples', x: 9200, y: -6960, capacity: 3 },
  { id: 'fern', name: 'Fern Apples', x: -13800, y: -2280, capacity: 3 },
  { id: 'reed', name: 'Reed Apples', x: 12300, y: 15100, capacity: 4 },
]);
export const CAVES = Object.freeze([
  { id: 'lantern', name: 'Lantern Hollow', x: -12000, y: -21700, tint: '#81d7cf', note: 'Blue crystals light a branching chamber beneath the northern ridge.' },
  { id: 'amber', name: 'Amber Grotto', x: 14500, y: -21600, tint: '#efc16e', note: 'Warm mineral seams glow in the eastern mountain stone.' },
  { id: 'echo', name: 'Echo Cavern', x: 21400, y: 10700, tint: '#bba0e8', note: 'A violet-lit cavern tucked into the eastern escarpment.' },
  { id: 'refuge', name: 'Willow Refuge', x: 2800, y: 1480, tint: '#b8c895', note: 'A sheltered chamber near the starting pond, insulated from wind and rain.' },
]);
export const LANDMARKS = Object.freeze([
  { id: 'trailhead', name: 'The Trailhead', x: SPAWN.x, y: SPAWN.y, kind: 'camp' },
  { id: 'lake', name: 'Stillwater Lake', x: -3550, y: -6500, kind: 'water' },
  { id: 'meadow', name: 'Sunfall Meadows', x: 6200, y: 4400, kind: 'meadow' },
  { id: 'grove', name: 'The Oldwood', x: -10600, y: 6100, kind: 'forest' },
  ...PONDS.map(p => ({ ...p, kind: 'water' })),
  ...CAVES.map(c => ({ ...c, kind: 'cave' })),
]);
export const CAVE_SPAWN = Object.freeze({ x: 1320, y: 1510 });
export const CAVE_EXIT = Object.freeze({ x: 1320, y: 1580 });
export const ENV_RULES = Object.freeze({
  minimumTemperature: 8, maximumTemperature: 30, minimumHour: 4, peakHour: 14,
  caveTemperature: 18, weatherSeconds: 180, weatherTransitionSeconds: 20,
  windCooling: 1.1, rainCooling: 3, shadeCooling: 4,
  foodRenewalSeconds: 600, maxElapsed: 3600 * 100000,
});
/** NPC time uses the same unpaused simulation seconds as the world. */
export const NPC_RULES = Object.freeze({
  tileSize: 80, visionRadius: 400, collectionRange: 80,
  flaskCapacity: 1, drinkHydration: 65, maxActionSeconds: 12,
  foodCapacity: 3, appleNourishment: 45, meaningfulNourishmentGain: 15,
  maxSkillSeconds: 35, maxExperience: 400, maxCells: 4096,
  maxSources: 128, maxSkills: 12, maxModelCallsPerHour: 60,
  thirstWarning: 45, criticalHydration: 20, meaningfulHydrationGain: 15,
  hungerWarning: 45, criticalNourishment: 20,
  comfortMinimum: 14, comfortMaximum: 26, hotComfortMax: 26, coldComfortMin: 14,
  thermalWarning: 40, criticalThermal: 80, hotStrainPerDegreeSecond: .33,
  // Cold warnings leave time to search for shelter before exposure damages health.
  coldStrainPerDegreeSecond: .12, thermalRecoveryPerSecond: 2,
  wettingPerSecond: .55, dryingPerSecond: .35,
  starvationDamagePerSecond: 1.2, dehydrationDamagePerSecond: 2,
  thermalDamagePerSecond: 1, healthRecoveryPerSecond: .03,
  rescueHealth: 65, rescueNourishment: 70,
});
export const NPC_PRESETS = Object.freeze({
  // Food is the more frequent gameplay need. Full water lasts 7m; food 3m30s.
  normal: { initialHydration: 85, depletionPerSecond: 100 / 420, initialNourishment: 85, nourishmentDepletionPerSecond: 100 / 210, rescueDelay: 14, recoverySeconds: 3, rescueHydration: 75, rescueNourishment: 75 },
  accelerated: { initialHydration: 75, depletionPerSecond: 300 / 420, initialNourishment: 75, nourishmentDepletionPerSecond: 300 / 210, rescueDelay: 7, recoverySeconds: 2, rescueHydration: 75, rescueNourishment: 75 },
});
/** Distinct body stores: food sustains energy, exertion spends stamina, sleep relieves sleep pressure. */
export const BODY_RULES = Object.freeze({
  initialEnergy: 85, initialStamina: 100, initialFatigue: 5, initialSleepPressure: 10,
  awakeEnergyPerSecond: .008, walkingEnergyPerSecond: .035,
  idleEnergyRecoveryPerSecond: .018, restEnergyRecoveryPerSecond: .05, sleepEnergyRecoveryPerSecond: .11,
  mealEnergyPerNourishment: .5, nourishmentForEnergyRecovery: 20,
  walkingStaminaPerSecond: .65, idleStaminaRecoveryPerSecond: .6,
  restStaminaRecoveryPerSecond: 2.5, sleepStaminaRecoveryPerSecond: 2,
  awakeFatiguePerSecond: .015, walkingFatiguePerSecond: .045,
  restFatigueRecoveryPerSecond: .12, sleepFatigueRecoveryPerSecond: .65,
  awakeSleepPressurePerSecond: .025, sleepPressureRecoveryPerSecond: .9,
  lowStamina: 15, highFatigue: 75, lowEnergy: 15, exhaustedWalkMultiplier: .65,
  restInterruptReserve: 25, restInterruptThermal: 40, restInterruptHealth: 25,
  rescueEnergy: 55, rescueStamina: 60, rescueFatigueMaximum: 60, rescueSleepPressureMaximum: 70,
});
export const SOCIAL_RULES = Object.freeze({
  peerRange: 400, noteRange: 180, speechCooldown: 35, questionCooldown: 180, topicCooldown: 900,
  maxMessages: 160, maxNotes: 24, maxText: 600, maxTitle: 80,
  maxRelationships: 8, maxHeard: 32, maxTopics: 24,
});
