import { CONFIG } from './config.js';

/** Approximate, configurable game physiology. Values are not clinical predictions. */
export const BIOLOGY_RULES = Object.freeze({
  // Appetite is gameplay meal memory, not a calorie store or metabolic rate.
  humanSatietyMaximumHours: 6, humanSatietyHoursPerKcal: 4 / 95,
  version: 1, maxDigestiveInputs: 24, maxFeedback: 64,
  feedbackDelayHours: .15, maximumTickHours: 1,
  humanSleepOnsetHours: 1 / 12, maximumSleepHours: 12,
  napHours: .5, nightSleepHours: 8, maximumRestHours: 1,
  awakePressurePerHour: 4.8, sleepPressureRecoveryPerHour: 10,
  awakeFatiguePerHour: .35, restFatigueRecoveryPerHour: 3,
  sleepFatigueRecoveryPerHour: 7, sleepInertiaHours: .25,
  exhaustionWalkMultiplier: .55,
  wettingPerHour: 25, dryingPerHour: 12,
  hotStrainPerDegreeHour: 2, coldStrainPerDegreeHour: 1.2,
  thermalRecoveryPerHour: 12, thermalDamagePerHour: .8,
  dehydrationDamageStartFraction: .05, dehydrationSevereFraction: .1,
  rescueEnergyKcal: 700, rescueWaterMl: 1800,
  rescueDelayGameHours: .25, recoveryGameHours: .05,
});

const profile = values => Object.freeze(values);
export const BIOLOGY_PROFILES = Object.freeze({
  human: profile({massKg:70,bodyWaterMl:42000,basalKcalPerDay:2400,waterMlPerDay:2100,
    availableCapacityKcal:1400,storedCapacityKcal:120000,initialStoredKcal:84000,
    stomachCapacityGrams:1400,mobilizeKcalPerHour:130,initialAvailableKcal:1100,
    walkingKcalPerHour:160,runningKcalPerHour:520,effortWaterMlPerHour:250,
    sleepHours:8,sleepOnsetHours:1/12,initialHoursSinceMeal:2,initialWaterDeficitMl:250}),
  rabbit: profile({massKg:2,bodyWaterMl:1300,basalKcalPerDay:200,waterMlPerDay:120,
    availableCapacityKcal:70,storedCapacityKcal:600,initialStoredKcal:450,
    stomachCapacityGrams:150,mobilizeKcalPerHour:12,initialAvailableKcal:55,
    walkingKcalPerHour:8,runningKcalPerHour:40,effortWaterMlPerHour:12,
    sleepHours:8,sleepOnsetHours:.01,initialHoursSinceMeal:1,initialWaterDeficitMl:5}),
  bobcat: profile({massKg:9,bodyWaterMl:5500,basalKcalPerDay:700,waterMlPerDay:400,
    availableCapacityKcal:500,storedCapacityKcal:6000,initialStoredKcal:4300,
    stomachCapacityGrams:1100,mobilizeKcalPerHour:40,initialAvailableKcal:400,
    walkingKcalPerHour:35,runningKcalPerHour:180,effortWaterMlPerHour:40,
    sleepHours:12,sleepOnsetHours:.02,initialHoursSinceMeal:3,initialWaterDeficitMl:25}),
  fox: profile({massKg:5,bodyWaterMl:3200,basalKcalPerDay:450,waterMlPerDay:250,
    availableCapacityKcal:260,storedCapacityKcal:3000,initialStoredKcal:2100,
    stomachCapacityGrams:600,mobilizeKcalPerHour:25,initialAvailableKcal:200,
    walkingKcalPerHour:25,runningKcalPerHour:120,effortWaterMlPerHour:28,
    sleepHours:10,sleepOnsetHours:.02,initialHoursSinceMeal:2,initialWaterDeficitMl:15}),
});

export const gameHours = seconds => seconds * 24 / CONFIG.dayRealSeconds;
export const simulationSeconds = hours => hours * CONFIG.dayRealSeconds / 24;
