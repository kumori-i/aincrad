// Deterministic physical drinking banks for the separate Ozark world. These
// points are generated from the saved geometry, never placed in agent memory
// until a nearby actor can actually see them.
import { CONFIG, NPC_RULES } from './config.js';
import { OZARK_WORLD_PROFILE } from './ozark-world-geometry.js';

const STEP = NPC_RULES.tileSize;
const ID = /^ozark-water:(-?(?:0|[1-9]\d{0,2})):(-?(?:0|[1-9]\d{0,2}))$/;
const BANK_MIN = CONFIG.playerRadius + 2;
const BANK_MAX = 65;
const MAX_VISIBLE = 24;

function geometryValid(geometry) {
  return geometry?.profile === OZARK_WORLD_PROFILE &&
    typeof geometry.sample === 'function' &&
    typeof geometry.classify === 'function' &&
    typeof geometry.lineOfSight === 'function';
}

/** Recompute a source from its canonical grid ID; no stored coordinates are trusted. */
export function ozarkWaterSource(id, geometry, environment = {}) {
  if (!geometryValid(geometry) || typeof id !== 'string' || id.length > 70) return null;
  const match = ID.exec(id);
  if (!match) return null;
  const x = Number(match[1]) * STEP, y = Number(match[2]) * STEP;
  if (id !== `ozark-water:${x / STEP}:${y / STEP}` ||
      x <= geometry.bounds.minX + CONFIG.playerRadius ||
      x >= geometry.bounds.maxX - CONFIG.playerRadius ||
      y <= geometry.bounds.minY + CONFIG.playerRadius ||
      y >= geometry.bounds.maxY - CONFIG.playerRadius) return null;
  const site = geometry.sample(x, y);
  const surface = site.surfaceWaterDistance * geometry.profile.cellPixels;
  const pond = site.sinkholePondDistance === null ? Infinity :
    site.sinkholePondDistance * geometry.profile.cellPixels;
  const waterDistance = Math.min(surface, pond);
  if (!Number.isFinite(waterDistance) || waterDistance < BANK_MIN ||
      waterDistance > BANK_MAX ||
      geometry.classify(x, y, CONFIG.playerRadius, 'walk').reason !== 'dry-ground') return null;
  const name = pond < surface ? 'Sinkhole pond shore' :
    ['spring-pool', 'spring-outflow'].includes(site.nearestChannel?.kind) ?
      'Spring bank' : 'Riverbank';
  return { id, name, x, y, scene: 'valley', kind: 'water',
    available: !(environment.unavailableSources || []).includes(id) };
}

/** Only visible bank points within the ordinary local perception radius. */
export function nearbyOzarkWaterSources(position, radius, geometry, environment = {}) {
  if (!geometryValid(geometry) || !Number.isFinite(position?.x) ||
      !Number.isFinite(position?.y) || !Number.isFinite(radius) || radius <= 0) return [];
  const reach = Math.min(radius, NPC_RULES.visionRadius);
  const sources = [];
  for (let row = Math.ceil((position.y - reach) / STEP);
       row <= Math.floor((position.y + reach) / STEP); row++) {
    for (let col = Math.ceil((position.x - reach) / STEP);
         col <= Math.floor((position.x + reach) / STEP); col++) {
      const point = { x: col * STEP, y: row * STEP };
      const distance = Math.hypot(point.x - position.x, point.y - position.y);
      if (distance > reach) continue;
      const source = ozarkWaterSource(`ozark-water:${col}:${row}`,
        geometry, environment);
      if (source && geometry.lineOfSight(position, point)) sources.push({
        source, distance,
      });
    }
  }
  sources.sort((a, b) => a.distance - b.distance ||
    a.source.id.localeCompare(b.source.id));
  return sources.slice(0, MAX_VISIBLE).map(row => row.source);
}
