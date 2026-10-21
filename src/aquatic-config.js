/** Engine-only fixed v1 coefficients. Frozen 2026-10-20, before behavioral
 * trials. An engineered shore-fish phenotype, not calibrated biology.
 * Wet-mass compartments already include their water; none is added twice. */
export const AQUATIC_RULES = Object.freeze({
  version:1, phenotype:'shore_fish_v1', maxInitialFish:32, maxLiveFish:32, fishPerPatch:4,
  radius:3, minInsidePixels:5, maxInsidePixels:35, shoreReach:80, contactPixels:12,
  scanPixels:160, patchSeparation:200, sweptStepPixels:2,
  cruisePixelsPerSecond:6, dartPixelsPerSecond:18, cruiseSeconds:3, dartSeconds:1,
  maintenanceKcalPerHour:.25, swimmingKcalPerHour:.25,
  // Reuse the native surface current rule at this fixed human actor reference
  // radius. This actor-dependent proxy is NOT measured bathymetry. Ponds have
  // no current. Native depthSpan/currentMaxSpeed/wadeMaxDepthProxy are used.
  currentReferenceRadius:10,
  tissue:Object.freeze({massGrams:80,energyKcal:80,waterMl:56}),
  residue:Object.freeze({massGrams:100,energyKcal:30,waterMl:60}),
  reserve:Object.freeze({massGrams:20,energyKcal:40,waterMl:10}),
  pullMaxGrams:100, digestHours:4, toxicity:.025, spoilDays:3,
});
export const AQUATIC_STOCK_FIELDS=Object.freeze(['massGrams','energyKcal','waterMl']);
export const AQUATIC_LEDGER_FIELDS=Object.freeze([
  'initialMassGrams','initialKcal','initialWaterMl',
  'humanIngestedMassGrams','humanIngestedKcal','humanIngestedWaterMl',
  'detritusTransferredMassGrams','detritusTransferredKcal','detritusTransferredWaterMl',
  'overflowLostMassGrams','overflowLostKcal','overflowLostWaterMl',
  'respirationMassGrams','metabolizedKcal','releasedWaterMl',
  'captureAttempts','captureMisses','captureFailures','captures','naturalDeaths',
  'pulls','ingestions','decayTransfers','cleanupTransfers',
]);
