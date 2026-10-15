/** Engine-only ecology metadata. Never spread these values into observations. */
export const ECOLOGY_RULES = Object.freeze({
  version: 1, distributionVersion: 3, stepSeconds: .5, maxPlants: 768, maxAnimals: 256, maxMaterials: 256,
  habitatGridSize: 7, habitatExtent: 20000, spatialCell: 640,
  maxDetritus: 500000, reach: 85, yearDays: 120, startSeasonDay: 74,
  grassKcalPerGram: .35, grassWaterPerGram: .7, grassGrowthGramsPerDay: 4800,
  grassCapacityGrams: 2500, fruitFallDays: 6, appleSpoilDays: 12, berrySpoilDays: 4,
  fleshSpoilDays: 3, materialDecayDays: 6, maxHumanAttackDamage: 12,
});
export const ECOLOGY_SPECIES = Object.freeze({
  rabbit: Object.freeze({ diet:'herbivore', speed:92, radius:7, sight:380, biteGrams:14, biteHours:.04, huntDamage:0, structureKcal:850, birthKcal:520, juvenileDays:16, litter:1, birthIntervalDays:18, sleepHours:8, maxPopulation:192, initialReserveKcal:240, reserveKcal:450 }),
  bobcat: Object.freeze({ diet:'carnivore', speed:145, radius:14, sight:550, biteGrams:75, biteHours:.09, huntDamage:38, structureKcal:3400, birthKcal:1800, juvenileDays:30, litter:1, birthIntervalDays:65, sleepHours:10, maxPopulation:16, initialReserveKcal:1000, reserveKcal:2200 }),
  fox: Object.freeze({ diet:'omnivore', speed:120, radius:11, sight:480, biteGrams:40, biteHours:.07, huntDamage:22, structureKcal:2100, birthKcal:1050, juvenileDays:24, litter:1, birthIntervalDays:40, sleepHours:8, maxPopulation:40, initialReserveKcal:600, reserveKcal:1400 }),
});
export const ECOLOGY_MATERIALS = Object.freeze({
  apple:Object.freeze({massGrams:180,energyKcal:95,waterMl:153,digestHours:2,texture:'smooth',color:'red-green',shape:'round',smell:'sweet',spoilDays:12}),
  berry:Object.freeze({massGrams:35,energyKcal:19,waterMl:28,digestHours:1.5,texture:'soft',color:'purple',shape:'small round clusters',smell:'faintly sweet',spoilDays:4}),
  grass:Object.freeze({massGrams:45,energyKcal:0,waterMl:14,digestHours:4,texture:'fibrous',color:'green',shape:'long narrow blades',smell:'fresh green',spoilDays:8,toxicity:.015}),
  flesh:Object.freeze({massGrams:100,energyKcal:140,waterMl:70,digestHours:4,texture:'soft and fibrous',color:'dark red',shape:'irregular',smell:'strong',spoilDays:3,toxicity:.025}),
});
