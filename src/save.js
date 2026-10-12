import { CONFIG, CAVES, CAVE_SPAWN, LANDMARKS } from './config.js';
import { freshState, canStand, clamp } from './world.js';
import { validateNpc } from './npc-memory.js';
export function validateSave(raw, {restoring=true}={}) {
  const base = freshState();
  if (!raw || typeof raw !== 'object' || ![1,2].includes(raw.version)) return base;
  const ids = new Set(CAVES.map(c => c.id));
  base.scene = ids.has(raw.scene) ? raw.scene : 'valley';
  const p = raw.player;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && canStand(p.x, p.y, base.scene)) base.player = { x: p.x, y: p.y };
  else if (base.scene !== 'valley') base.player = { ...CAVE_SPAWN };
  base.elapsed = Number.isFinite(raw.elapsed) ? clamp(raw.elapsed, 0, 3600 * 100000) : 0;
  base.distance = Number.isFinite(raw.distance) ? clamp(raw.distance, 0, 1e12) : 0;
  base.discoveries = [...new Set(['trailhead', ...(Array.isArray(raw.discoveries) ? raw.discoveries : []).filter(v => LANDMARKS.some(l => l.id === v))])];
  base.visitedCaves = [...new Set((Array.isArray(raw.visitedCaves) ? raw.visitedCaves : []).filter(v => ids.has(v)))];
  const wp = raw.waypoint;
  if (wp && Number.isFinite(wp.x) && Number.isFinite(wp.y) && Math.abs(wp.x) < CONFIG.halfSize && Math.abs(wp.y) < CONFIG.halfSize) base.waypoint = { x: wp.x, y: wp.y };
  if(raw.npc)base.npc=validateNpc(raw.npc,{restoring});
  return base;
}
export function loadSave(storage) {
  try {
    const data = storage.getItem(CONFIG.saveKey);
    if (!data) return { state: freshState(), exists: false, error: null };
    const parsed = JSON.parse(data);
    if (![1,2].includes(parsed?.version)) return { state: freshState(), exists: false, error: 'The previous save is not compatible. A new expedition is ready.' };
    return { state: validateSave(parsed), exists: true, error: null };
  } catch { return { state: freshState(), exists: false, error: 'The local save could not be read. Your previous data has not been overwritten.' }; }
}
export function writeSave(storage, state) {
  try { storage.setItem(CONFIG.saveKey, JSON.stringify(validateSave(state,{restoring:false}))); return true; }
  catch { return false; }
}
