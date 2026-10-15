/** Supplied body primitives and bounded learning budgets; no food recipes or species tables. */
export const DISCOVERY_RULES=Object.freeze({
  // Owner opt-in experiment. Change to true and restart via npm start; no reset.
  experimentalSelection:false,
  primitives:['inspect_object','grasp','release','pull','sample','strike'],
  reach:80,capacity:4,maxObjects:128,maxExperiments:160,maxEffects:64,maxReports:24,maxTechniques:24,
  durations:{inspect_object:1.8,grasp:2.5,release:1.2,pull:5,sample:3.5,strike:4},
  effort:{inspect_object:.25,grasp:.5,release:.25,pull:1.5,sample:.35,strike:2.2},
  minimumCostMultiplier:.55,practiceScale:20,sampleGrams:30,
  feedbackWaitSeconds:45,experimentInterval:.65,searchRadius:4200,
});
