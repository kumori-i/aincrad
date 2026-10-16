/** Engine-only juvenile accounting. Material mass is the existing wet-mass proxy.
 * Water is an auxiliary property of that mass, never an additional mass stock.
 * This module has no world mutation, placement, observations or food knowledge.
 */
export const JUVENILE_RULES = Object.freeze({
  version: 1, seedMassGrams: 2, germinationAgeHours: 96,
  maxMassGrams: 250, growthGramsPerDay: 8, growthKcalPerGram: .5,
  growthWaterMlPerGram: .7, nutrientsPerGram: .004,
  droughtThreshold: .1, droughtLossPerDay: .12, terminalMassGrams: .1,
});
const valid = value => Number.isFinite(value) && value >= 0;
const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
const stock = value => value && valid(value.massGrams) && valid(value.energyKcal)
  && valid(value.waterMl) && value.waterMl <= value.massGrams;
const zero = () => ({massGrams: 0, energyKcal: 0, waterMl: 0});

/** Plan an exact finite transfer; caller checks opportunity, time and placement. */
export function seedTransfer(material) {
  if (!stock(material) || material.massGrams < JUVENILE_RULES.seedMassGrams) return null;
  const f = JUVENILE_RULES.seedMassGrams / material.massGrams;
  const transferred = {massGrams: JUVENILE_RULES.seedMassGrams,
    energyKcal: material.energyKcal * f, waterMl: material.waterMl * f};
  return {transferred, remaining: Object.fromEntries(Object.keys(transferred)
    .map(key => [key, material[key] - transferred[key]]))};
}

/** Pure demand calculation. Caller must consume these exact local nutrient units
 * before adding stock; a smaller admission requires recalculating this plan.
 */
export function juvenileGrowth(current, {days, moisture, daylight, productivity = 1,
  multiplier = 1, soilNutrients} = {}) {
  if (!stock(current) || !valid(days) || !fraction(moisture) || !fraction(daylight)
    || !valid(productivity) || !valid(multiplier) || !valid(soilNutrients)) return null;
  const demand = moisture < JUVENILE_RULES.droughtThreshold || days === 0 || daylight === 0
    || productivity === 0 || multiplier === 0 ? 0 :
    JUVENILE_RULES.growthGramsPerDay * days * daylight * moisture * productivity * multiplier;
  if (!Number.isFinite(demand)) return null;
  const g = Math.min(Math.max(0, JUVENILE_RULES.maxMassGrams - current.massGrams),
    soilNutrients / JUVENILE_RULES.nutrientsPerGram,
    demand);
  return {input: {massGrams: g, energyKcal: g * JUVENILE_RULES.growthKcalPerGram,
    waterMl: g * JUVENILE_RULES.growthWaterMlPerGram},
    nutrientCost: g * JUVENILE_RULES.nutrientsPerGram};
}

/** Drought retains (1 - daily loss fraction) ** days, so constant-condition
 * losses compose across time partitions. Releases proportional finite stock,
 * including an exact terminal
 * remainder. Detritus receives mass/energy; auxiliary water is a release counter.
 */
export function juvenileLoss(current, {days, moisture} = {}) {
  if (!stock(current) || !valid(days) || !fraction(moisture)) return null;
  const f = moisture < JUVENILE_RULES.droughtThreshold
    ? -Math.expm1(days * Math.log1p(-JUVENILE_RULES.droughtLossPerDay)) : 0;
  const terminal = f > 0 && current.massGrams * (1 - f) < JUVENILE_RULES.terminalMassGrams;
  const lost = Object.fromEntries(Object.keys(zero()).map(key => [key, current[key] * (terminal ? 1 : f)]));
  return {lost, remaining: Object.fromEntries(Object.keys(lost).map(key => [key, current[key] - lost[key]])), terminal};
}
