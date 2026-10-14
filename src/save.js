import { CONFIG, CAVES, CAVE_SPAWN, LANDMARKS } from './config.js';
import { freshState, canStand, clamp } from './world.js';
import { validateNpc } from './npc-memory.js';
import { validateEnvironment } from './environment.js';
import { createNpc } from './npc-state.js';
import { validateCommunity } from './social.js';
const SAVE_VERSIONS = new Set([1,2,3,4]);
const AGENT_IDS = ['aster','mira'];
function newCharacterAt(id,elapsed){
  const npc=createNpc({id});
  // A newly added body joins the existing clock without experiencing its past.
  npc.elapsed=elapsed;npc.lifecycleAt=elapsed;npc.nextDecisionAt=elapsed;
  npc.bodyFeedback.since=elapsed;npc.modelBudget.since=elapsed;
  if(npc.cognition){
    npc.cognition.bornAt=elapsed;
    npc.cognition.lastKnowledgeAt=elapsed;npc.cognition.lastPlanAt=elapsed-30;
    npc.cognition.lastNoteAt=elapsed;
  }
  return npc;
}
export function validateSave(raw, {restoring=true}={}) {
  const base = freshState();
  if (!raw || typeof raw !== 'object' || !SAVE_VERSIONS.has(raw.version)) return base;
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
  base.environment=validateEnvironment(raw.environment,{elapsed:base.elapsed});
  // Keep the historical Aster alias authoritative for older saves and callers
  // that replace raw.npc explicitly; the reconstructed alias shares one object.
  const records = new Map();
  for (const candidate of (Array.isArray(raw.agents)?raw.agents:[]).slice(0,16)) {
    if (AGENT_IDS.includes(candidate?.id) && [1,2,3].includes(candidate.version) && !records.has(candidate.id)) records.set(candidate.id,candidate);
  }
  if (raw.npc?.id==='aster' && [1,2,3].includes(raw.npc.version)) records.set('aster',raw.npc);
  base.agents=AGENT_IDS.map(id=>records.has(id)?validateNpc(records.get(id),{restoring}):newCharacterAt(id,base.elapsed));
  base.npc=base.agents[0];
  base.selectedAgentId=AGENT_IDS.includes(raw.selectedAgentId)?raw.selectedAgentId:'aster';
  base.community=validateCommunity(raw.community);
  return base;
}
export function loadSave(storage) {
  try {
    const data = storage.getItem(CONFIG.saveKey);
    if (!data) return { state: freshState(), exists: false, error: null };
    const parsed = JSON.parse(data);
    if (!SAVE_VERSIONS.has(parsed?.version)) return { state: freshState(), exists: false, error: 'The previous save is not compatible. A new expedition is ready.' };
    return { state: validateSave(parsed), exists: true, error: null };
  } catch { return { state: freshState(), exists: false, error: 'The local save could not be read. Your previous data has not been overwritten.' }; }
}
export function writeSave(storage, state) {
  try {
    const {npc:historicalAlias,...saved}=validateSave(state,{restoring:false});
    storage.setItem(CONFIG.saveKey, JSON.stringify(saved));
    return true;
  }
  catch { return false; }
}
