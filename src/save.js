import { CONFIG, CAVES, CAVE_SPAWN, LANDMARKS } from './config.js';
import { freshState, canStand, clamp } from './world.js';
import { validateNpc } from './npc-memory.js';
import { validateEnvironment } from './environment.js';
import { createNpc } from './npc-state.js';
import { validateCommunity } from './social.js';
import { ECOLOGY_RULES } from './ecology-config.js';
import { BIOLOGY_RULES } from './biology-config.js';
import { validateCardinal } from './cardinal.js';
import { encodeTemporalWire,TEMPORAL_STORAGE } from './temporal-storage.js';
const SAVE_VERSIONS = new Set([1,2,3,4,5,6,7]);
const AGENT_IDS = ['aster','mira'];
function unsupportedRules(raw){
  const ecology=raw.environment?.ecology;
  if(ecology?.distributionVersion===3&&(ecology.regionalVersion!==1||!Array.isArray(ecology.regions)||ecology.regions.length!==ECOLOGY_RULES.habitatGridSize**2))return true;
  if(ecology&&[['plants',ECOLOGY_RULES.maxPlants],['animals',ECOLOGY_RULES.maxAnimals],['materials',ECOLOGY_RULES.maxMaterials],['regions',ECOLOGY_RULES.habitatGridSize**2]].some(([key,max])=>Array.isArray(ecology[key])&&ecology[key].length>max))return true;
  if(raw?.version>=5&&!['legacy','discovery'].includes(raw.simulationMode))return true;
  if(raw.environment?.schemaVersion!=null&&![1,2,3].includes(raw.environment.schemaVersion))return true;
  if(raw.environment?.worldRules && raw.environment.worldRules.version!==1)return true;
  if(raw.cardinal && raw.cardinal.version!==1)return true;
  if(raw.environment?.ecology?.distributionVersion!=null&&![1,2,3].includes(raw.environment.ecology.distributionVersion))return true;
  if(raw.environment?.ecology?.regionalVersion!=null&&raw.environment.ecology.regionalVersion!==1)return true;
  if(raw.environment?.ecology?.version>ECOLOGY_RULES.version)return true;
  const maximumActorVersion=raw?.version>=5&&raw.simulationMode==='discovery'?4:3;
  return [...(Array.isArray(raw.agents)?raw.agents:[]),raw.npc].filter(Boolean).some(npc=>npc?.version>maximumActorVersion||npc?.physiology?.version>BIOLOGY_RULES.version||npc?.discovery?.version>1||unsupportedTemporal(npc?.discovery?.temporal,raw.version));
}
function unsupportedTemporal(temporal,saveVersion){
  return temporal!=null&&(temporal.version!==1||(temporal.encoding!==undefined&&(temporal.encoding!==TEMPORAL_STORAGE.encoding||saveVersion<7)));
}
function newCharacterAt(id,elapsed,mode){
  const npc=createNpc({id,mode});
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
  const supported=raw&&typeof raw==='object'&&SAVE_VERSIONS.has(raw.version)&&!unsupportedRules(raw);
  const mode=supported&&(raw.version<5||raw.simulationMode!=='discovery')?'legacy':'discovery';
  const base = freshState({mode,populateEcology:!supported});
  if (!supported) return base;
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
  base.environment=validateEnvironment(raw.environment,{elapsed:base.elapsed,mode});
  base.cardinal=validateCardinal(raw.cardinal??base.cardinal,{restoring});
  // Historical worlds retain their former simulation rules. Cardinal can
  // diagnose them, but automatic rule experiments require discovery physics.
  if(mode==='legacy'&&base.cardinal.mode==='adaptive')base.cardinal.mode='observe';
  // Canonical agents are serialized only once. Preserve the old Aster alias for
  // historical saves and callers; discovery records cannot import old recipes.
  const records = new Map(), validVersions=mode==='discovery'?[4]:[1,2,3];
  for (const candidate of (Array.isArray(raw.agents)?raw.agents:[]).slice(0,16)) {
    if (AGENT_IDS.includes(candidate?.id) && validVersions.includes(candidate.version) && !records.has(candidate.id)) records.set(candidate.id,candidate);
  }
  if (raw.npc?.id==='aster' && validVersions.includes(raw.npc.version)) records.set('aster',raw.npc);
  base.agents=AGENT_IDS.map(id=>records.has(id)?validateNpc({...records.get(id),mode},{restoring}):newCharacterAt(id,base.elapsed,mode));
  if(mode==='discovery'){
    // Two serialized hands never own two copies of the same physical material.
    // Repair orphaned held objects by putting the existing material down, rather
    // than inventing acquisition evidence or silently destroying the resource.
    const materials=base.environment.ecology.materials;
    for(const npc of base.agents)npc.inventory.items=npc.inventory.items.filter(id=>materials.some(item=>item.id===id&&item.heldBy===npc.id));
    for(const item of materials){
      const holder=base.agents.find(npc=>npc.id===item.heldBy);
      if(holder&&!holder.inventory.items.includes(item.id)){item.heldBy=null;item.position={...holder.position};item.scene=holder.scene;}
    }
  }
  base.npc=base.agents[0];
  base.selectedAgentId=AGENT_IDS.includes(raw.selectedAgentId)?raw.selectedAgentId:'aster';
  base.community=validateCommunity(raw.community);
  return base;
}
function protectedFresh(error){
  const state=freshState();
  // A failed read must not become a fresh autosave over the user's existing disk
  // data. Explicitly starting a new expedition creates an unprotected state.
  Object.defineProperty(state,'saveBlocked',{value:true,enumerable:false});
  return {state,exists:false,error,blocked:true};
}
export function loadSave(storage) {
  try {
    const data = storage.getItem(CONFIG.saveKey);
    if (!data) return { state: freshState(), exists: false, error: null, blocked:false };
    const parsed = JSON.parse(data);
    if (!SAVE_VERSIONS.has(parsed?.version)||unsupportedRules(parsed)) return protectedFresh('The previous save uses unsupported rules or a newer version. It has been preserved; start a new expedition explicitly to replace it.');
    return { state: validateSave(parsed), exists: true, error: null, blocked:false };
  } catch(error) { return protectedFresh(error?.code==='TEMPORAL_BUDGET'||error?.code==='TEMPORAL_STORAGE'?'The experimental learner memory exceeds its budget or has an unsupported encoding. Your previous save has been preserved.':'The local save could not be read. Your previous data has not been overwritten.'); }
}
/** Pure preparation shared by synchronous storage and the experimental worker.
 * Protection is explicit because structured cloning omits saveBlocked. */
export function prepareSave(state,{blocked=false}={}) {
  if(blocked||state?.saveBlocked)throw Object.assign(new Error('The existing save is protected.'),{code:'SAVE_BLOCKED'});
  if(!SAVE_VERSIONS.has(state?.version)||unsupportedRules(state))throw Object.assign(new Error('Unsupported save rules.'),{code:'SAVE_RULES'});
  const {npc:historicalAlias,...saved}=validateSave(state,{restoring:false});
  // Validate the live proof graph first; dictionary encoding is wire-only.
  for(const actor of saved.agents)if(actor.discovery?.temporal){actor.discovery.temporal=encodeTemporalWire(actor.discovery.temporal);saved.version=7;}
  return JSON.stringify(saved);
}
export function writeSave(storage, state) {
  try { storage.setItem(CONFIG.saveKey,prepareSave(state));return true; }
  catch { return false; }
}
