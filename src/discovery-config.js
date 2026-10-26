/** Supplied body primitives and bounded learning budgets; no food recipes or species tables. */
export const DISCOVERY_RULES=Object.freeze({
  // Original-world menu stays byte-for-byte ordered and contains no catch.
  primitives:['inspect_object','grasp','release','pull','sample','strike'],
  allPrimitives:['inspect_object','grasp','release','pull','sample','strike','catch'],
  reach:80,capacity:4,maxObjects:128,maxExperiments:168,maxEffects:64,maxReports:24,maxTechniques:24,
  durations:{inspect_object:1.8,grasp:2.5,release:1.2,pull:5,sample:3.5,strike:4,catch:4},
  effort:{inspect_object:.25,grasp:.5,release:.25,pull:1.5,sample:.35,strike:2.2,catch:1.5},
  minimumCostMultiplier:.55,practiceScale:20,sampleGrams:30,
  catchObservationMaxAge:1,feedbackWaitSeconds:45,experimentInterval:.65,searchRadius:4200,
});
