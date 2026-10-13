import { CONFIG, ENV_RULES, APPLE_PATCHES, CAVES, PONDS } from './config.js';
import { clamp, lerp, hash, distance, objectsInRect, terrain, canStandOutside } from './world.js';

export const WEATHER_KINDS = Object.freeze(['clear', 'cloudy', 'rainy', 'windy']);
const WEATHER_EFFECTS = Object.freeze({
  clear: { wind: .6, offset: 0 }, cloudy: { wind: 1.1, offset: -2 },
  rainy: { wind: 1.8, offset: -ENV_RULES.rainCooling }, windy: { wind: 3.6, offset: -1 },
});
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
const safeElapsed = v => clamp(finite(v, 0), 0, ENV_RULES.maxElapsed);
const pointOf = actor => actor?.position || actor || { x: 0, y: 0 };
function weatherAt(index, seed) {
  const n = hash(index, 811, seed);
  return n < .42 ? 'clear' : n < .68 ? 'cloudy' : n < .84 ? 'rainy' : 'windy';
}
function updateWeather(env) {
  const index = Math.floor(env.elapsed / ENV_RULES.weatherSeconds);
  const kind = weatherAt(index, env.seed), previous = weatherAt(Math.max(0, index - 1), env.seed);
  const phase = clamp((env.elapsed - index * ENV_RULES.weatherSeconds) / ENV_RULES.weatherTransitionSeconds, 0, 1);
  env.weather = {
    kind, previous, changedAt: index * ENV_RULES.weatherSeconds, duration: ENV_RULES.weatherSeconds,
    wind: lerp(WEATHER_EFFECTS[previous].wind, WEATHER_EFFECTS[kind].wind, phase),
    temperatureOffset: lerp(WEATHER_EFFECTS[previous].offset, WEATHER_EFFECTS[kind].offset, phase),
  };
}
export function createEnvironment(seed = CONFIG.seed) {
  const env = {
    schemaVersion: 1, seed: Number.isInteger(seed) ? seed >>> 0 : CONFIG.seed, elapsed: 0,
    settings: { hourOverride: null, weatherOverride: null }, weather: null,
    foodStocks: APPLE_PATCHES.map(p => ({ id: `apple:${p.id}`, stock: p.capacity, renewAt: ENV_RULES.foodRenewalSeconds })),
  };
  updateWeather(env); return env;
}
/** Called once by the authoritative unpaused world update, never by artwork. */
export function tickEnvironment(env, dt) {
  if (!env || !Number.isFinite(dt) || dt <= 0) return;
  env.elapsed = safeElapsed(env.elapsed + Math.min(dt, 86400));
  updateWeather(env);
  for (const entry of env.foodStocks || []) {
    const patch = APPLE_PATCHES.find(p => `apple:${p.id}` === entry.id);
    if (patch && env.elapsed >= entry.renewAt) {
      entry.stock = patch.capacity;
      entry.renewAt += (Math.floor((env.elapsed - entry.renewAt) / ENV_RULES.foodRenewalSeconds) + 1) * ENV_RULES.foodRenewalSeconds;
    }
  }
}
/** Ignore arbitrary fields, forged weather and unknown resource IDs in disk saves. */
export function validateEnvironment(raw, { elapsed } = {}) {
  const base = createEnvironment(Number.isInteger(raw?.seed) ? raw.seed : CONFIG.seed);
  base.elapsed = safeElapsed(Number.isFinite(elapsed) ? elapsed : raw?.elapsed);
  const hour = raw?.settings?.hourOverride;
  base.settings.hourOverride = Number.isFinite(hour) && hour >= 0 && hour < 24 ? hour : null;
  base.settings.weatherOverride = WEATHER_KINDS.includes(raw?.settings?.weatherOverride) ? raw.settings.weatherOverride : null;
  const entries = Array.isArray(raw?.foodStocks) ? raw.foodStocks.slice(0, APPLE_PATCHES.length) : [];
  for (const entry of base.foodStocks) {
    const patch = APPLE_PATCHES.find(p => entry.id === `apple:${p.id}`);
    const saved = entries.find(e => e?.id === entry.id);
    if (!saved) { entry.renewAt = base.elapsed + ENV_RULES.foodRenewalSeconds; continue; }
    entry.stock = clamp(Math.floor(finite(saved.stock, patch.capacity)), 0, patch.capacity);
    entry.renewAt = clamp(finite(saved.renewAt, base.elapsed + ENV_RULES.foodRenewalSeconds), base.elapsed, base.elapsed + ENV_RULES.foodRenewalSeconds);
    if (entry.renewAt <= base.elapsed) {
      entry.stock = patch.capacity; entry.renewAt = base.elapsed + ENV_RULES.foodRenewalSeconds;
    }
  }
  updateWeather(base); return base;
}
export function environmentHour(env) {
  const override = env?.settings?.hourOverride;
  if (Number.isFinite(override) && override >= 0 && override < 24) return override;
  return (CONFIG.startHour + safeElapsed(env?.elapsed) / CONFIG.dayRealSeconds * 24) % 24;
}
export function dailyTemperature(hour) {
  const phase = ((finite(hour, CONFIG.startHour) - ENV_RULES.minimumHour) % 24 + 24) % 24;
  const rise = ENV_RULES.peakHour - ENV_RULES.minimumHour;
  const progress = phase <= rise ? phase / rise : (24 - phase) / (24 - rise);
  const warmth = (1 - Math.cos(Math.PI * clamp(progress, 0, 1))) / 2;
  return lerp(ENV_RULES.minimumTemperature, ENV_RULES.maximumTemperature, warmth);
}
export function environmentConditions(env = {}, actor = {}) {
  const position = pointOf(actor), hour = environmentHour(env), scene = actor.scene || 'valley';
  const sheltered = scene !== 'valley' && CAVES.some(c => c.id === scene);
  const override = env.settings?.weatherOverride;
  const weather = WEATHER_KINDS.includes(override) ? override : WEATHER_KINDS.includes(env.weather?.kind) ? env.weather.kind : weatherAt(Math.floor(safeElapsed(env.elapsed) / ENV_RULES.weatherSeconds), Number.isInteger(env.seed) ? env.seed : CONFIG.seed);
  const effect = WEATHER_EFFECTS[weather];
  const wind = sheltered ? 0 : (WEATHER_KINDS.includes(override) ? effect.wind : finite(env.weather?.wind, effect.wind));
  const shade = !sheltered && objectsInRect(position.x - 145, position.y - 145, 290, 290)
    .some(o => ['oak', 'pine'].includes(o.kind) && distance(o, position) < 85 * o.scale);
  const airTemperature = sheltered ? ENV_RULES.caveTemperature : dailyTemperature(hour)
    + (WEATHER_KINDS.includes(override) ? effect.offset : finite(env.weather?.temperatureOffset, effect.offset));
  const wetness = clamp(finite(actor.wetness ?? actor.thermal?.wetness, 0), 0, 100) / 100;
  const raining = !sheltered && weather === 'rainy';
  const shadeCooling = shade && hour >= 7 && hour <= 19 ? ENV_RULES.shadeCooling : 0;
  const feltTemperature = sheltered ? ENV_RULES.caveTemperature : airTemperature - wind * ENV_RULES.windCooling - shadeCooling - wetness * 3;
  return { hour, weather, airTemperature, temperature: airTemperature, feltTemperature, wind, sheltered, shade, raining, rain: raining };
}
export function localConditions(env, position, scene = 'valley') {
  return environmentConditions(env, { position, scene });
}
/** Decorative ecology derives from the same clock. No harvesting or animal minds yet. */
export function ambientEcology(position, radius = 800, env = {}) {
  const point = pointOf(position), r = clamp(finite(radius, 800), 0, 1800), elapsed = safeElapsed(env.elapsed), entities = [];
  if (position?.scene && position.scene !== 'valley') return entities;
  const seed = Number.isInteger(env.seed) ? env.seed : CONFIG.seed;
  for (const pond of PONDS) {
    if (distance(point, pond) > r + Math.max(pond.rx, pond.ry)) continue;
    for (let i = 0; i < 3; i++) {
      const angle = elapsed * .035 + i * Math.PI * 2 / 3 + hash(i, pond.x, seed) * 3;
      entities.push({ id: `fish:${pond.id}:${i}`, kind: 'fish', x: pond.x + Math.cos(angle) * pond.rx * .53, y: pond.y + Math.sin(angle) * pond.ry * .53, facing: { x: -Math.sin(angle), y: Math.cos(angle) }, moving: true, variant: i });
    }
  }
  const cell = 650;
  for (let y = Math.floor((point.y - r) / cell); y <= Math.floor((point.y + r) / cell); y++) {
    for (let x = Math.floor((point.x - r) / cell); x <= Math.floor((point.x + r) / cell); x++) {
      const h = hash(x, y, seed ^ 4771);
      if (h > .36) continue;
      const anchor = { x: (x + .3 + hash(x, y, 722) * .4) * cell, y: (y + .3 + hash(x, y, 947) * .4) * cell };
      if (!['meadow', 'forest', 'trail'].includes(terrain(anchor.x, anchor.y)) || !canStandOutside(anchor.x, anchor.y)) continue;
      const kind = h < .12 ? 'bird' : h < .26 ? 'rabbit' : 'deer', phase = elapsed * (kind === 'bird' ? .32 : .065) + h * 100;
      const moving = Math.floor((elapsed + h * 100) / 12) % 3 !== 0;
      let p = moving ? { x: anchor.x + Math.cos(phase) * 28, y: anchor.y + Math.sin(phase * .7) * 20 } : anchor;
      if (kind !== 'bird' && !canStandOutside(p.x, p.y)) p = anchor;
      if (distance(point, p) <= r) entities.push({ id: `${kind}:${x}:${y}`, kind, ...p, facing: { x: -Math.sin(phase), y: Math.cos(phase * .7) }, moving, variant: Math.floor(h * 10) % 3 });
    }
  }
  const plantCell = 240;
  for (let y = Math.floor((point.y - r) / plantCell); y <= Math.floor((point.y + r) / plantCell); y++) {
    for (let x = Math.floor((point.x - r) / plantCell); x <= Math.floor((point.x + r) / plantCell); x++) {
      const h = hash(x, y, seed ^ 12419), p = { x: (x + .5) * plantCell, y: (y + .5) * plantCell };
      if (h < .23 && distance(point, p) <= r && ['meadow', 'forest'].includes(terrain(p.x, p.y))) entities.push({ id: `flowers:${x}:${y}`, kind: 'flowers', ...p, moving: false, variant: Math.floor(h * 100) % 3 });
    }
  }
  return entities.slice(0, 160);
}
