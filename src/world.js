import { CONFIG, CAVES, SPAWN, CAVE_SPAWN, CAVE_EXIT } from './config.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function hash(x, y, seed = CONFIG.seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, y, scale = 1000, seed = CONFIG.seed) {
  x /= scale; y /= scale;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(ix, iy, seed), hash(ix + 1, iy, seed), sx),
    lerp(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), sx), sy);
}
export function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, d2 = dx * dx + dy * dy;
  const t = d2 ? clamp(((x - ax) * dx + (y - ay) * dy) / d2, 0, 1) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
export function riverX(y) {
  return -1600 + Math.sin(y / 3100) * 1700 + Math.sin(y / 7400) * 1300;
}
export function riverWidth(y) { return 130 + (Math.sin(y / 2100) + 1) * 34; }
export const BRIDGES = [0, -12600, 11800].map(y => ({ x: riverX(y), y }));
export const LAKE = { x: -3550, y: -6500, rx: 3150, ry: 2380 };
export function lakeDistance(x, y) {
  const dx = (x - LAKE.x) / LAKE.rx, dy = (y - LAKE.y) / LAKE.ry;
  const a = Math.atan2(dy, dx);
  return (Math.hypot(dx, dy) - 1 - Math.sin(a * 5 + 0.6) * .038 - Math.sin(a * 9) * .015) * 2500;
}
export function waterDistance(x, y) {
  return Math.min(Math.abs(x - riverX(y)) - riverWidth(y), lakeDistance(x, y));
}
export function onBridge(x, y) {
  return BRIDGES.some(b => Math.abs(y - b.y) < 70 && Math.abs(x - b.x) < riverWidth(b.y) + 110);
}
export function ridgeValue(x, y) {
  return Math.pow(Math.abs(x) / CONFIG.valleyRadius, 8) + Math.pow(Math.abs(y) / CONFIG.valleyRadius, 8);
}
const CAVE_TRAILS = [
  [-12000, -21700, -12000, -12600],
  [14500, -21600, 14500, -12600],
  [21400, 10700, 21400, 11800],
];
export function trailDistance(x, y) {
  // The central east/west route is guaranteed clear, including a real bridge.
  let d = Math.abs(y);
  if (Math.abs(x) < 21600) d = Math.min(d, Math.abs(y + 12600), Math.abs(y - 11800));
  d = Math.min(d, Math.abs(x - (6500 + Math.sin(y / 4700) * 700)));
  for (const s of CAVE_TRAILS) d = Math.min(d, segmentDistance(x, y, ...s));
  return d;
}
export function caveMountain(x, y) {
  return CAVES.find(c => Math.hypot((x - c.x) / 1.1, y - c.y + 125) < 220);
}
export function terrain(x, y) {
  const ridge = ridgeValue(x, y);
  if (ridge >= 1) return 'mountain';
  if (onBridge(x, y)) return 'bridge';
  const water = waterDistance(x, y);
  if (water < -50) return 'water';
  if (water < 0) return 'shallows';
  if (water < 80) return 'shore';
  const cm = caveMountain(x, y);
  if (cm && !(Math.abs(x - cm.x) < 65 && y > cm.y - 40)) return 'mountain';
  if (trailDistance(x, y) < 55 || distance({ x, y }, SPAWN) < 125) return 'trail';
  if (ridge > .83) return 'scree';
  return forestAmount(x, y) > .54 ? 'forest' : 'meadow';
}
export function forestAmount(x, y) {
  const grove = Math.exp(-((x + 10600) ** 2 + (y - 6100) ** 2) / 12000000) * .27;
  return noise(x, y, 1800, 833) * .75 + noise(x, y, 6300, 2901) * .25 + grove;
}
export function objectAtCell(cx, cy) {
  const h = hash(cx, cy, 12863);
  const x = (cx + .16 + hash(cx, cy, 6921) * .68) * CONFIG.treeCell;
  const y = (cy + .16 + hash(cx, cy, 1839) * .68) * CONFIG.treeCell;
  if (trailDistance(x, y) < 115 || distance({ x, y }, SPAWN) < 240 || CAVES.some(c => distance(c, { x, y }) < 330)) return null;
  const t = terrain(x, y);
  if (!['forest', 'meadow', 'scree'].includes(t)) return null;
  const density = t === 'forest' ? .85 : t === 'scree' ? .32 : .16;
  if (h > density) return null;
  const variant = Math.floor(hash(cx, cy, 3827) * 6);
  const kind = t === 'scree' || h < .018 ? 'rock' : (variant < 3 ? 'pine' : 'oak');
  return { x, y, kind, variant, scale: .8 + hash(cx, cy, 3948) * .6, radius: kind === 'rock' ? 23 : 16, seed: hash(cx, cy, 8816) };
}
export function objectsInRect(x, y, w, h) {
  const out = [], s = CONFIG.treeCell;
  for (let cy = Math.floor(y / s); cy <= Math.floor((y + h) / s); cy++)
    for (let cx = Math.floor(x / s); cx <= Math.floor((x + w) / s); cx++) {
      const o = objectAtCell(cx, cy); if (o) out.push(o);
    }
  return out;
}
export function solidGround(x, y) {
  const t = terrain(x, y);
  return t === 'mountain' || t === 'water' || t === 'shallows';
}
export function canStandOutside(x, y, radius = CONFIG.playerRadius) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    if (solidGround(x + Math.cos(a) * radius, y + Math.sin(a) * radius)) return false;
  }
  const cell = CONFIG.treeCell, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const o = objectAtCell(cx + i, cy + j);
    if (o && Math.hypot(o.x - x, o.y - y) < radius + o.radius * o.scale) return false;
  }
  return true;
}

export const CAVE_ROOMS = [
  { x: 1320, y: 1490, rx: 185, ry: 175 },
  { x: 1270, y: 1070, rx: 300, ry: 270 },
  { x: 740, y: 730, rx: 285, ry: 245 },
  { x: 1730, y: 610, rx: 340, ry: 275 },
  { x: 1270, y: 300, rx: 245, ry: 165 },
];
export const CAVE_CORRIDORS = [[0, 1, 92], [1, 2, 105], [1, 3, 100], [3, 4, 83]];
export function caveDistance(x, y) {
  let d = Infinity;
  for (const r of CAVE_ROOMS) d = Math.min(d, (Math.hypot((x - r.x) / r.rx, (y - r.y) / r.ry) - 1) * Math.min(r.rx, r.ry));
  for (const [a, b, width] of CAVE_CORRIDORS) {
    const ra = CAVE_ROOMS[a], rb = CAVE_ROOMS[b];
    d = Math.min(d, segmentDistance(x, y, ra.x, ra.y, rb.x, rb.y) - width);
  }
  return d;
}
export function caveObjectAt(cx, cy) {
  const x = (cx + .2 + hash(cx, cy, 345) * .6) * 115;
  const y = (cy + .2 + hash(cx, cy, 789) * .6) * 115;
  if (caveDistance(x, y) > -30 || caveDistance(x, y) < -95 || hash(cx, cy, 823) > .55 || distance({x,y}, CAVE_EXIT) < 145) return null;
  return { x, y, kind: hash(cx, cy, 971) < .46 ? 'crystal' : 'stalagmite', variant: 1, scale: .7 + hash(cx, cy, 278) * .65, radius: 15, seed: hash(cx, cy, 831) };
}
export function caveObjects() {
  const out = [];
  for (let y = 0; y < 17; y++) for (let x = 0; x < 23; x++) { const o = caveObjectAt(x,y); if (o) out.push(o); }
  return out;
}
export const CAVE_OBJECTS = caveObjects();
export function canStandCave(x, y, radius = CONFIG.playerRadius) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || caveDistance(x, y) > -radius) return false;
  return !CAVE_OBJECTS.some(o => distance(o, {x, y}) < radius + o.radius * o.scale);
}
export function canStand(x, y, scene = 'valley') {
  return scene === 'valley' ? canStandOutside(x, y) : canStandCave(x, y);
}
/** Authoritative movement, shared by the human controller and future NPCs. */
export function moveActor(actor, dx, dy, dt, sprint = false, scene = 'valley') {
  const len = Math.hypot(dx, dy);
  if (!len || !Number.isFinite(dt) || dt <= 0) return 0;
  const speed = CONFIG.walkSpeed * (sprint ? CONFIG.sprintMultiplier : 1);
  const vx = dx / len * speed * Math.min(dt, .25), vy = dy / len * speed * Math.min(dt, .25);
  const steps = Math.max(1, Math.ceil(Math.hypot(vx, vy) / (CONFIG.playerRadius * .6)));
  const oldX = actor.x, oldY = actor.y;
  for (let i = 0; i < steps; i++) {
    if (canStand(actor.x + vx / steps, actor.y, scene)) actor.x += vx / steps;
    if (canStand(actor.x, actor.y + vy / steps, scene)) actor.y += vy / steps;
  }
  return Math.hypot(actor.x - oldX, actor.y - oldY);
}
export function nearestInteraction(actor, scene) {
  if (scene !== 'valley') return distance(actor, CAVE_EXIT) < 100 ? { type: 'exit', name: 'Return to the valley' } : null;
  const c = CAVES.find(c => distance(actor, { x: c.x, y: c.y + 55 }) < 100);
  if (c) return { type: 'enter', ...c };
  if (distance(actor, { x: SPAWN.x + 110, y: SPAWN.y - 55 }) < 110) return { type: 'sign', name: 'Read the trail sign' };
  return null;
}
export function regionName(x, y, scene) {
  if (scene !== 'valley') return CAVES.find(c => c.id === scene)?.name ?? 'The Caverns';
  const c = CAVES.find(c => distance(c, { x, y }) < 1100);
  if (c) return c.name + ' approach';
  if (distance({ x, y }, SPAWN) < 750) return 'The Trailhead';
  if (lakeDistance(x, y) < 600) return 'Stillwater Lake';
  if (Math.abs(x - riverX(y)) < 700) return 'The Silverrun';
  if (ridgeValue(x, y) > .5) return 'Crown Ridge';
  if (forestAmount(x, y) > .54) return 'The Oldwood';
  return y > 0 ? 'Sunfall Meadows' : 'The High Meadows';
}
export function freshState() {
  return { version: 1, scene: 'valley', player: { ...SPAWN }, elapsed: 0, distance: 0, discoveries: ['trailhead'], visitedCaves: [], waypoint: null };
}
export function clockTime(elapsed) {
  const seconds = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const gameHours = CONFIG.startHour + seconds / CONFIG.dayRealSeconds * 24;
  const minute = Math.floor((gameHours % 24) * 60);
  return { day: Math.floor(gameHours / 24) + 1, hour: Math.floor(minute / 60), minute: minute % 60, fraction: (gameHours % 24) / 24 };
}
