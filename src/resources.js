import { CONFIG, NPC_RULES, PONDS, APPLE_PATCHES, CAVES, ENV_RULES } from './config.js';
import { riverX, riverWidth, LAKE, waterDistance, canStandOutside, distance, onBridge } from './world.js';

const pointOf = actor => actor?.position || actor;
/** Physical draw points belong to the engine, never the controller's initial knowledge. */
export function waterSource(id, environment = {}) {
  if (typeof id !== 'string' || id.length > 70) return null;
  let point, name;
  const river = /^river:(west|east):(-?\d{1,3})$/.exec(id);
  const lake = /^lake:(\d{1,2})$/.exec(id);
  const pond = /^pond:([a-z-]{1,24}):([0-7])$/.exec(id);
  if (river) {
    const row = Number(river[2]); if (Math.abs(row) > 145) return null;
    const y = row * 160, x = riverX(y) + (river[1] === 'west' ? -1 : 1) * (riverWidth(y) + 34);
    point = { x, y }; name = 'Silverrun bank';
    if (onBridge(x, y) || waterDistance(x, y) < 12 || waterDistance(x, y) > 65) return null;
  } else if (lake) {
    const n = Number(lake[1]); if (n >= 64) return null;
    const a = n / 64 * Math.PI * 2;
    let lo = .85, hi = 1.2;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2, x = LAKE.x + Math.cos(a) * LAKE.rx * m, y = LAKE.y + Math.sin(a) * LAKE.ry * m;
      if (waterDistance(x, y) < 34) lo = m; else hi = m;
    }
    point = { x: LAKE.x + Math.cos(a) * LAKE.rx * hi, y: LAKE.y + Math.sin(a) * LAKE.ry * hi }; name = 'Stillwater shore';
    if (waterDistance(point.x, point.y) > 65) return null;
  } else if (pond) {
    const definition = PONDS.find(p => p.id === pond[1]); if (!definition) return null;
    const a = Number(pond[2]) / 8 * Math.PI * 2, scale = 1 + 34 / Math.min(definition.rx, definition.ry);
    point = { x: definition.x + Math.cos(a) * definition.rx * scale, y: definition.y + Math.sin(a) * definition.ry * scale };
    name = definition.name + ' bank';
  } else return null;
  if (!canStandOutside(point.x, point.y)) return null;
  return { id, name, ...point, available: !(environment.unavailableSources || []).includes(id), scene: 'valley', kind: 'water' };
}
export function nearbyWaterSources(actor, radius = NPC_RULES.visionRadius, environment = {}) {
  const position = pointOf(actor), result = [];
  if (!position || actor?.scene && actor.scene !== 'valley') return result;
  for (let row = Math.floor((position.y - radius) / 160); row <= Math.ceil((position.y + radius) / 160); row++) {
    for (const side of ['west', 'east']) { const s = waterSource(`river:${side}:${row}`, environment); if (s && distance(position, s) <= radius) result.push(s); }
  }
  if (distance(position, LAKE) < Math.max(LAKE.rx, LAKE.ry) + radius + 300) {
    for (let n = 0; n < 64; n++) { const s = waterSource(`lake:${n}`, environment); if (s && distance(position, s) <= radius) result.push(s); }
  }
  for (const p of PONDS) if (distance(position, p) <= Math.max(p.rx, p.ry) + radius + 100) {
    for (let n = 0; n < 8; n++) { const s = waterSource(`pond:${p.id}:${n}`, environment); if (s && distance(position, s) <= radius) result.push(s); }
  }
  return result;
}
export function foodSource(id, environment = {}) {
  if (typeof id !== 'string' || id.length > 70) return null;
  const patch = APPLE_PATCHES.find(p => `apple:${p.id}` === id);
  if (!patch || !canStandOutside(patch.x, patch.y)) return null;
  const entry = environment.foodStocks?.find?.(e => e.id === id);
  const stock = entry ? Math.max(0, Math.min(patch.capacity, Math.floor(entry.stock))) : patch.capacity;
  return { id, name: patch.name, x: patch.x, y: patch.y, scene: 'valley', kind: 'food', item: 'apple', stock, capacity: patch.capacity, renewAt: entry?.renewAt ?? null, available: stock > 0 && !(environment.unavailableFoodSources || []).includes(id) };
}
export function nearbyFoodSources(actor, radius = NPC_RULES.visionRadius, environment = {}) {
  const position = pointOf(actor);
  if (!position || actor?.scene && actor.scene !== 'valley') return [];
  return APPLE_PATCHES.map(p => foodSource(`apple:${p.id}`, environment)).filter(s => s && distance(position, s) <= radius);
}
/** Range, inventory and awake checks are owned by NPC actions; this is resource stock mutation only. */
export function gatherFood(id, environment = {}, amount = 1) {
  const source = foodSource(id, environment);
  if (!source) return { ok: false, amount: 0, remaining: 0, code: 'UNKNOWN_SOURCE' };
  if (!source.available) return { ok: false, amount: 0, remaining: source.stock, code: 'RESOURCE_DEPLETED' };
  if (!Number.isInteger(amount) || amount < 1 || amount > NPC_RULES.foodCapacity) return { ok: false, amount: 0, remaining: source.stock, code: 'INVALID_AMOUNT' };
  if (!Array.isArray(environment.foodStocks)) environment.foodStocks = APPLE_PATCHES.map(p => ({ id: `apple:${p.id}`, stock: p.capacity, renewAt: (Number.isFinite(environment.elapsed) ? environment.elapsed : 0) + ENV_RULES.foodRenewalSeconds }));
  const entry = environment.foodStocks.find(e => e.id === id);
  if (!entry) return { ok: false, amount: 0, remaining: 0, code: 'UNKNOWN_SOURCE' };
  const gathered = Math.min(amount, source.stock);
  if (entry.stock === source.capacity) entry.renewAt = (Number.isFinite(environment.elapsed) ? environment.elapsed : 0) + ENV_RULES.foodRenewalSeconds;
  entry.stock -= gathered;
  return { ok: true, amount: gathered, remaining: entry.stock, code: 'GATHERED' };
}
export function shelterSource(id) {
  const cave = CAVES.find(c => c.id === id);
  if (!cave) return null;
  return { id, name: cave.name, x: cave.x, y: cave.y + 55, scene: 'valley', targetScene: id, kind: 'shelter', available: true, shelteredTemperature: ENV_RULES.caveTemperature };
}
export function nearbyShelters(actor, radius = NPC_RULES.visionRadius) {
  const position = pointOf(actor);
  if (!position || actor?.scene && actor.scene !== 'valley') return [];
  return CAVES.map(c => shelterSource(c.id)).filter(s => distance(position, s) <= radius);
}
export function validSourceId(id) { return typeof id === 'string' && Boolean(waterSource(id)); }
export function validFoodSourceId(id) { return typeof id === 'string' && Boolean(foodSource(id)); }
export function validShelterId(id) { return typeof id === 'string' && Boolean(shelterSource(id)); }
export function withinWorld(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < CONFIG.halfSize && Math.abs(p.y) < CONFIG.halfSize; }
