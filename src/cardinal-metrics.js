import { CONFIG } from './config.js';
import { BIOLOGY_PROFILES, gameHours } from './biology-config.js';
import { ECOLOGY_MATERIALS, ECOLOGY_RULES } from './ecology-config.js';

// Private engine instrumentation. Never include these measurements in an
// inhabitant observation or use a journal claim as physical evidence.
const n = value => Number.isFinite(value) ? value : 0;
const positive = value => Math.max(0, n(value));
const sum = (items, get) => items.reduce((total, item) => total + n(get(item)), 0);
const mean = (items, get) => items.length ? sum(items, get) / items.length : 0;
const clamp = (value, lo=0, hi=1) => Math.max(lo, Math.min(hi, n(value)));
const physiologyEnergy = body => positive(body?.availableEnergyKcal) + positive(body?.storedEnergyKcal) + sum(body?.stomach || [], item => positive(item.remainingKcal));
const plantEnergy = plant => plant.kind === 'grass' ? positive(plant.biomassGrams) * ECOLOGY_RULES.grassKcalPerGram : positive(plant.quantity) * (ECOLOGY_MATERIALS[plant.kind === 'apple_tree' ? 'apple' : 'berry']?.energyKcal || 0);
const moving = actor => actor.active?.request?.type === 'move' || ['moving','fleeing','chasing'].includes(actor.activity);
const actorWaterFraction = actor => positive(actor.physiology?.waterDeficitMl) / Math.max(1, (BIOLOGY_PROFILES[actor.physiology?.profile]?.massKg || 70) * 1000);
const blockedOutcomes = actor => (actor.memory?.experience || []).filter(event => ['ROUTE_BLOCKED','ACTION_TIMEOUT'].includes(event.details?.result?.code)).length;

function grounded(actor) {
  const discovery = actor.discovery || {}, experiments = discovery.experiments || [], effects = discovery.effects || [];
  const samples = experiments.filter(item => item.ok === true && item.primitive === 'sample' && item.ingestionId);
  const evidenced = technique => technique.confidence !== 'revised' && samples.some(sample =>
    (technique.evidence || []).includes(sample.id) && effects.some(effect => effect.effect === 'sustained' && effect.source === 'experienced' && effect.ingestionId === sample.ingestionId && effect.actionId === sample.actionId));
  return {
    // These cumulative engine counters advance only after successful, timed
    // physical primitives. They are separate from dietary adequacy.
    practice: sum(Object.values(discovery.practice || {}), item => positive(item.seconds)),
    techniques: (discovery.techniques || []).filter(evidenced).length,
  };
}

/** Cumulative diagnostics; values are never substituted for bodily sensations. */
export function measureCardinalWorld(state) {
  const humans = (state?.agents || []).filter(actor => actor?.physiology), ecology = state?.environment?.ecology;
  const animals = ecology?.animals || [], plants = ecology?.plants || [], materials = ecology?.materials || [];
  const ledger = Object.fromEntries(['initialKcal','photosynthesisKcal','humanRemovedKcal','metabolizedKcal','decomposedKcal','discardedKcal','birthTransferredKcal','externalKcal','waterConsumedMl','animalAbsorbedKcal','animalAbsorbedWaterMl','animalWaterLostMl'].map(key => [key, n(ecology?.ledger?.[key])]));
  const resourceEnergy = sum(plants, plantEnergy) + sum(materials, item => positive(item.energyKcal));
  const biomassGrams=sum(plants,item=>positive(item.biomassGrams)),biomassCapacityGrams=sum(plants.filter(item=>item.kind==='grass'),item=>positive(item.capacity));
  const remainingKcal = resourceEnergy + sum(plants, plant=>positive(plant.structureKcal)) + sum(animals, actor => positive(actor.structureKcal) + physiologyEnergy(actor.physiology)) + positive(ecology?.detritus?.energyKcal);
  const species = {};
  for (const animal of animals) species[animal.species] = (species[animal.species] || 0) + 1;
  const skills = humans.map(grounded);
  return {
    version: 1, at: n(state?.elapsed ?? state?.environment?.elapsed),
    humans: {
      count: humans.length, healthMean: mean(humans, actor => actor.physiology.health), minimumHealth: humans.length ? Math.min(...humans.map(actor => n(actor.physiology.health))) : 100,
      fatigueMean: mean(humans, actor => actor.physiology.fatigue), waterDebtMl: sum(humans, actor => positive(actor.physiology.waterDeficitMl)), waterDebtFraction: mean(humans, actorWaterFraction),
      thermalStrain: mean(humans, actor => Math.max(n(actor.thermal?.hot),n(actor.thermal?.cold))),
      energyStoredKcal: sum(humans, actor => positive(actor.physiology.availableEnergyKcal) + positive(actor.physiology.storedEnergyKcal)),
      absorbedKcal: sum(humans, actor => actor.physiology.totals?.absorbedKcal), spentKcal: sum(humans, actor => actor.physiology.totals?.metabolizedKcal),
      absorbedWaterMl: sum(humans, actor => actor.physiology.totals?.absorbedWaterMl), waterLostMl: sum(humans, actor => actor.physiology.totals?.waterLostMl),
      assistanceKcal: sum(humans, actor => actor.physiology.outsideAssistance?.energyKcal), assistanceWaterMl: sum(humans, actor => actor.physiology.outsideAssistance?.waterMl),
      rescues: sum(humans, actor => actor.stats?.rescues), collapses: sum(humans, actor => actor.stats?.collapses), criticalSeconds: sum(humans, actor => actor.stats?.criticalSeconds),
      groundedPractice: sum(skills, item => item.practice), learnedTechniques: sum(skills, item => item.techniques),
      routeStalls: sum(humans, blockedOutcomes),
    },
    animals: {
      count: animals.length, species, speciesCount: Object.keys(species).length,
      healthMean: mean(animals, actor => actor.physiology?.health ?? actor.health),
      waterDebtMl: sum(animals, actor => actor.physiology?.waterDeficitMl), waterDebtFraction: mean(animals, actorWaterFraction),
      energyStoredKcal: sum(animals, actor => positive(actor.physiology?.availableEnergyKcal) + positive(actor.physiology?.storedEnergyKcal)),
      routeStalls: sum(animals, actor => positive(actor.navigation?.stalls ?? actor.routeStalls)),
      // Ecosystem flow counters survive an animal's death or birth. Summing only
      // currently living bodies would lose their already spent/absorbed energy.
      absorbedKcal: ledger.animalAbsorbedKcal, spentKcal: ledger.metabolizedKcal,
      absorbedWaterMl: ledger.animalAbsorbedWaterMl, waterLostMl: ledger.animalWaterLostMl,
    },
    resources: {biomassGrams, fruitUnits: sum(plants, item => positive(item.quantity)), availableKcal: resourceEnergy, plantCount: plants.length,
      meanMoisture: mean(plants,item=>n(item.moisture)),biomassCapacityGrams,biomassFraction:biomassCapacityGrams?biomassGrams/biomassCapacityGrams:0},
    ecology: {ledger, remainingKcal, balanceErrorKcal: ledger.initialKcal + ledger.photosynthesisKcal + ledger.externalKcal - remainingKcal - ledger.humanRemovedKcal - ledger.metabolizedKcal - ledger.decomposedKcal - ledger.discardedKcal,
      births: n(ecology?.births), deaths: n(ecology?.deaths)},
  };
}

/** Interval totals retain endpoints so reserve drawdown cannot masquerade as food. */
export function compareCardinalMetrics(before, after) {
  const seconds = Math.max(0, n(after?.at) - n(before?.at)), hours = gameHours(seconds);
  const interval = group => Object.fromEntries(Object.keys(after[group]).filter(key => typeof after[group][key] === 'number').map(key => [key, n(after[group][key]) - n(before[group]?.[key])]));
  const humans = interval('humans'), animals = interval('animals');
  return {
    seconds, gameHours: hours, before, after,
    humans: {...humans, nutritionRatio: humans.spentKcal > 0 ? Math.max(0, humans.absorbedKcal) / humans.spentKcal : 0,
      waterCoverageRatio: humans.waterLostMl > 0 ? Math.max(0, humans.absorbedWaterMl) / humans.waterLostMl : 0,
      criticalHours: gameHours(Math.max(0, humans.criticalSeconds)),
      // Rescue relief is direct assistance, not absorbed independent intake.
      independentAbsorbedKcal: Math.max(0, humans.absorbedKcal), independentWaterMl: Math.max(0, humans.absorbedWaterMl)},
    animals: {...animals, nutritionRatio: animals.spentKcal > 0 ? Math.max(0, animals.absorbedKcal) / animals.spentKcal : 0,
      waterCoverageRatio: animals.waterLostMl > 0 ? Math.max(0, animals.absorbedWaterMl) / animals.waterLostMl : 0},
    resources: interval('resources'), ecology: {photosynthesisKcal: n(after.ecology.ledger.photosynthesisKcal) - n(before.ecology.ledger.photosynthesisKcal),
      externalKcal: n(after.ecology.ledger.externalKcal) - n(before.ecology.ledger.externalKcal), balanceErrorKcal: after.ecology.balanceErrorKcal,
      births: after.ecology.births - before.ecology.births, deaths: after.ecology.deaths - before.ecology.deaths},
  };
}

/** Collects time spent impaired and stalled, including animal failures without a completed action. */
export function createCardinalMetricTracker(state) {
  const before = measureCardinalWorld(state), previous = new Map();
  let humanStallSeconds=0, animalStallSeconds=0, humanFatigueSeconds=0, humanThermalSeconds=0, animalCriticalSeconds=0;
  let minimumHealth=before.humans.minimumHealth;
  function sample(current, dt) {
    for (const [kind, actors] of [['human',current.agents || []],['animal',current.environment?.ecology?.animals || []]]) {
      for (const actor of actors) {
        const key=`${kind}:${actor.id}`, old=previous.get(key), p=actor.position;
        if (old && old.scene===actor.scene && moving(actor) && Math.hypot(p.x-old.x,p.y-old.y)<.05) {
          if (kind==='human') humanStallSeconds+=dt; else animalStallSeconds+=dt;
        }
        if (p) previous.set(key,{x:p.x,y:p.y,scene:actor.scene});
        if (kind==='human') {humanFatigueSeconds+=positive(actor.physiology?.fatigue)*dt;humanThermalSeconds+=Math.max(n(actor.thermal?.hot),n(actor.thermal?.cold))*dt;minimumHealth=Math.min(minimumHealth,n(actor.physiology?.health));}
        else if (actorWaterFraction(actor)>=.05 || n(actor.physiology?.health)<35 || n(actor.physiology?.availableEnergyKcal)<=0) animalCriticalSeconds+=dt;
      }
    }
  }
  sample(state,0);
  return {sample, finish(current) {
    const metrics=compareCardinalMetrics(before,measureCardinalWorld(current));
    metrics.humans.minimumHealth=minimumHealth;metrics.humans.stallSeconds=humanStallSeconds;
    metrics.humans.meanFatigue=metrics.seconds && before.humans.count ? humanFatigueSeconds/(metrics.seconds*before.humans.count) : before.humans.fatigueMean;
    metrics.humans.meanThermalStrain=metrics.seconds && before.humans.count ? humanThermalSeconds/(metrics.seconds*before.humans.count) : before.humans.thermalStrain;
    metrics.animals.stallSeconds=animalStallSeconds;metrics.animals.criticalHours=gameHours(animalCriticalSeconds);
    return metrics;
  }};
}

/** Published bounded utility: actual intake, impairment, and an accounted ecosystem. */
export function scoreCardinalMetrics(metrics) {
  const end=metrics.after, start=metrics.before, human=metrics.humans, animal=metrics.animals;
  const humanSeconds=Math.max(1,metrics.seconds*start.humans.count), animalSeconds=Math.max(1,metrics.seconds*start.animals.count);
  const components={
    nutrition: start.humans.count ? clamp(human.nutritionRatio) : 0,
    hydration: start.humans.count ? clamp(human.waterCoverageRatio) : 0,
    health: start.humans.count ? clamp((human.minimumHealth ?? end.humans.minimumHealth)/100) : 1,
    fatigue: 1-clamp((human.meanFatigue ?? end.humans.fatigueMean)/100),
    thermal: 1-clamp((human.meanThermalStrain ?? end.humans.thermalStrain)/100),
    critical: 1-clamp(positive(human.criticalSeconds)/humanSeconds),
    movement: 1-clamp((positive(human.stallSeconds)+positive(animal.stallSeconds))/(humanSeconds+animalSeconds)),
    animalNutrition: start.animals.count ? clamp(animal.nutritionRatio) : 0,
    diversity: start.animals.speciesCount ? clamp(end.animals.speciesCount/start.animals.speciesCount) : 1,
    resources: clamp(end.resources.availableKcal/Math.max(100,start.resources.availableKcal),0,2)/2,
    practice: clamp(positive(human.groundedPractice)/Math.max(1,humanSeconds*.1)),
  };
  const weights={nutrition:.21,hydration:.15,health:.08,fatigue:.05,thermal:.08,critical:.1,movement:.08,animalNutrition:.08,diversity:.05,resources:.1,practice:.02};
  const score=Object.keys(weights).reduce((total,key)=>total+weights[key]*components[key],0);
  return {score,components,weights};
}

export const CARDINAL_METRIC_UNITS=Object.freeze({seconds:'unpaused simulation seconds',gameHours:`24 hours per ${CONFIG.dayRealSeconds} simulation seconds`,energy:'kcal',water:'ml',health:'engine scale 0–100',utility:'bounded 0–1; no death-count reward'});
