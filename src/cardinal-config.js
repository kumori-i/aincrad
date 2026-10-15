import { CONFIG } from './config.js';
/** Engine-only steward settings. Cardinal never changes an inhabitant's body or memory. */
export const CARDINAL_RULES = Object.freeze({
  version:1, observationSeconds:30, minHistorySeconds:90, experimentIntervalSeconds:120,
  experimentHorizonSeconds:900, hypothesisRetrySeconds:CONFIG.dayRealSeconds, shadowBudget:8, minimumGain:.01,
  maximumHoldoutLoss:.005, monitoringSeconds:300, rollbackHealthLoss:15,
  rollbackAssistanceIncrease:0, maxObservations:48, maxDiagnoses:64,
  maxProposals:40, maxExperiments:32, maxInterventions:40, maxLearning:40,
});
/** Each experiment changes one existing physical rule. Calendar changes are manual only. */
export const CARDINAL_ACTUATORS = Object.freeze({
  plantGrowthMultiplier:Object.freeze({min:.25,max:3,step:.25,kind:'production'}),
  fruitYieldMultiplier:Object.freeze({min:.25,max:3,step:.25,kind:'production'}),
  animalForagingRangeMultiplier:Object.freeze({min:.5,max:2,step:.2,kind:'habitat'}),
  animalReproductionMultiplier:Object.freeze({min:0,max:2,step:.2,kind:'population'}),
  temperatureOffsetC:Object.freeze({min:-6,max:6,step:1,kind:'weather'}),
  rainfallMultiplier:Object.freeze({min:0,max:2.5,step:.25,kind:'weather'}),
  windMultiplier:Object.freeze({min:.25,max:2,step:.2,kind:'weather'}),
  seasonLengthMultiplier:Object.freeze({min:.5,max:2,step:.1,kind:'calendar'}),
});
export const CARDINAL_MODES = Object.freeze(['adaptive','observe','off']);
