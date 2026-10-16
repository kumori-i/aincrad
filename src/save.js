import { CONFIG, CAVES, CAVE_SPAWN, LANDMARKS } from './config.js';
import { freshState, canStand, clamp } from './world.js';
import { validateNpc } from './npc-memory.js';
import { validateEnvironment } from './environment.js';
import { createNpc } from './npc-state.js';
import { validateCommunity } from './social.js';
import { ECOLOGY_RULES } from './ecology-config.js';
import { BIOLOGY_RULES, BIOLOGY_PROFILES } from './biology-config.js';
import { validateCardinal } from './cardinal.js';
import { hasLifecyclePayload, lifecycleError } from './plant-lifecycle-state.js';
import { objectId } from './discovery-state.js';
import { LEGACY_PHYSICAL_PROVENANCE, LEGACY_UNKNOWN_PHYSICAL_PROVENANCE, planProofRetention, retainedEffectProofError, retainedProofIntegrityError } from './proof-retention.js';
const SAVE_VERSIONS = new Set([1,2,3,4,5,6,8]);
const AGENT_IDS = ['aster','mira'];
const PROOF_WARNING='Learned evidence in this expedition is incomplete or depends on an older feedback queue. The original save has been preserved. Export a raw backup from this recovery screen before considering recovery.';
const MARKED_WARNING='A migrated expedition has incomplete physical or learned evidence. Its saved bytes have been preserved.';
function canonicalNumberId(value,prefix){
  if(typeof value!=='string')return null;
  const match=value.match(new RegExp(`^${prefix}:([1-9]\\d*)$`));
  if(!match)return null;
  const id=Number(match[1]);return Number.isSafeInteger(id)&&id>0?id:null;
}
function receiptlessWorldIdentityError(state,actors){
  const rows=actors.flatMap(actor=>[
    ...(Array.isArray(actor.physiology?.stomach)?actor.physiology.stomach:[]),
    ...(Array.isArray(actor.physiology?.feedback)?actor.physiology.feedback:[]),
  ].filter(row=>row?.provenance===LEGACY_UNKNOWN_PHYSICAL_PROVENANCE)
    .map(row=>({actor,row})));
  if(!rows.length)return false;
  const high=state.environment?.ecology?.nextId;
  return !Number.isSafeInteger(high)||high<=1||!finiteTime(state.elapsed)||
    rows.some(({actor,row})=>{
      const id=canonicalNumberId(row.objectId,'object');
      return id===null||id>=high||!finiteTime(actor.elapsed)||
        actor.elapsed>state.elapsed||!finiteTime(row.at)||row.at>state.elapsed;
    });
}
export function saveProtectionReason(state){
  if(state?.saveBlocked)return state.saveBlockedReason||'The original save is protected and has not been overwritten.';
  if(state?.simulationMode!=='discovery')return null;
  if(state.features?.legacyPendingPhysicalOnly===1&&markedEnvelopeError(state))return MARKED_WARNING;
  const actors=[...(Array.isArray(state.agents)?state.agents:[]),state.npc].filter(Boolean);
  const hasLegacyPhysicalRow=actors.some(n=>
    [...(Array.isArray(n.physiology?.stomach)?n.physiology.stomach:[]),
      ...(Array.isArray(n.physiology?.feedback)?n.physiology.feedback:[])].some(row=>
      row?.provenance===LEGACY_PHYSICAL_PROVENANCE||row?.provenance===LEGACY_UNKNOWN_PHYSICAL_PROVENANCE));
  if(hasLegacyPhysicalRow&&state.features?.legacyPendingPhysicalOnly!==1)return PROOF_WARNING;
  if(receiptlessWorldIdentityError(state,actors))return MARKED_WARNING;
  // The envelope selects discovery rules on restore. A serialized actor cannot
  // opt out of the raw proof check by claiming legacy mode inside that world.
  return actors.some(n=>n.mode!=='discovery'||n.proofRetentionError||retainedProofIntegrityError(n))?
    (state.features?.legacyPendingPhysicalOnly===1?MARKED_WARNING:PROOF_WARNING):null;
}

function unsupportedRules(raw){
  const ecology=raw.environment?.ecology;
  // v7 contains a separate research learner. Even a mislabeled older envelope
  // must not silently drop its temporal payload on this stable-world branch.
  if([...(Array.isArray(raw.agents)?raw.agents:[]),raw.npc].filter(Boolean).some(n=>n.discovery&&Object.hasOwn(n.discovery,'temporal')))return true;
  if(raw.version===8){
    if(!raw.features||raw.features.plantLifecycle!==1||
        Object.keys(raw.features).some(k=>k!=='plantLifecycle'&&k!=='legacyPendingPhysicalOnly')||
        (Object.hasOwn(raw.features,'legacyPendingPhysicalOnly')&&
          (raw.features.legacyPendingPhysicalOnly!==1||raw.simulationMode!=='discovery')))return true;
    if(raw.simulationMode==='discovery'&&(ecology?.distributionVersion!==3||ecology?.regionalVersion!==1||lifecycleError(ecology)))return true;
    if(raw.simulationMode==='legacy'&&ecology)return true;
  }else if(Object.hasOwn(raw,'features')||hasLifecyclePayload(ecology))return true;
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
  return [...(Array.isArray(raw.agents)?raw.agents:[]),raw.npc].filter(Boolean).some(npc=>npc?.version>maximumActorVersion||npc?.physiology?.version>BIOLOGY_RULES.version||npc?.discovery?.version>1);
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
  const protection=saveProtectionReason(raw);
  const supported=raw&&typeof raw==='object'&&SAVE_VERSIONS.has(raw.version)&&!unsupportedRules(raw)&&!protection;
  const mode=supported&&(raw.version<5||raw.simulationMode!=='discovery')?'legacy':'discovery';
  const base = freshState({mode,populateEcology:!supported});
  if (!supported) {
    // Direct validation is also a load boundary, never authorization to erase an
    // unsupported source through a later ordinary autosave.
    Object.defineProperty(base,'saveBlocked',{value:true,enumerable:false});
    if(protection)Object.defineProperty(base,'saveBlockedReason',{value:protection,enumerable:false});
    return base;
  }
  // Sticky for the lifetime of a migrated world: an older writer must refuse
  // the envelope even after its last marked digestive input has drained.
  if(raw.features?.legacyPendingPhysicalOnly===1)base.features.legacyPendingPhysicalOnly=1;
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
  Object.defineProperty(state,'saveBlockedReason',{value:error,enumerable:false});
  return {state,exists:false,error,blocked:true};
}
export function loadSave(storage) {
  try {
    const data = storage.getItem(CONFIG.saveKey);
    if (!data) return { state: freshState(), exists: false, error: null, blocked:false };
    const parsed = JSON.parse(data);
    const protection=saveProtectionReason(parsed);if(protection)return protectedFresh(protection);
    if (!SAVE_VERSIONS.has(parsed?.version)||unsupportedRules(parsed)) return protectedFresh('The previous save uses unsupported rules or a newer version. It has been preserved; start a new expedition explicitly to replace it.');
    const state=validateSave(parsed);
    const restoredProtection=saveProtectionReason(state);
    if(restoredProtection)return protectedFresh(restoredProtection);
    if(parsed.features?.legacyPendingPhysicalOnly===1&&markedContinuityError(parsed,state,{fromDisk:true}))
      return protectedFresh(MARKED_WARNING);
    return { state, exists: true, error: null, blocked:false };
  } catch { return protectedFresh('The local save could not be read. Your previous data has not been overwritten.'); }
}
export function writeSave(storage, state) {
  if(saveProtectionReason(state)||!SAVE_VERSIONS.has(state?.version)||unsupportedRules(state))return false;
  try {
    const canonical=validateSave(state,{restoring:false});
    if(saveProtectionReason(canonical))return false;
    if(state.features?.legacyPendingPhysicalOnly===1&&markedContinuityError(state,canonical))return false;
    const {npc:historicalAlias,...saved}=canonical;
    storage.setItem(CONFIG.saveKey, JSON.stringify(saved));
    return true;
  }
  catch { return false; }
}

const MAX_MIGRATION_RAW_BYTES=16*1024*1024;
const WORLD_CONTINUITY_FIELDS=['scene','player','elapsed','distance','discoveries','visitedCaves','waypoint','environment'];
const ACTOR_PHYSICAL_FIELDS=['scene','position','elapsed','flask','inventory','thermal','lifecycle','lifecycleAt',
  'collapseCause','feelings','sensation','stats','hydration','nourishment','energy',
  'stamina','fatigue','sleepPressure','health','bodyMode','physiology'];
const DISCOVERY_CONTINUITY_FIELDS=['version','nextId','observations','experiments','effects',
  'reports','techniques','practice','trials','seenFeedback','lastAttemptAt','lastDialogueAt',
  'reportCursor','search','samplesPending','foodDiscoveries'];
const MEMORY_CONTINUITY_FIELDS=['cells','caveCells','caveExits','blockedEdges','caveEdges',
  'sources','foods','shelters','skills','values','features','effects','lessons','explorationCredit','exploration'];
const MEMORY_WRITE_FIELDS=['nextId','experience','skills','values','features','effects','lessons','explorationCredit'];
const positiveId=value=>Number.isInteger(value)&&value>0;
const ingestionId=value=>typeof value==='string'&&/^ingestion:\d+$/.test(value);
const finiteTime=value=>Number.isFinite(value)&&value>=0;
const finiteRange=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const bodyEpsilon=1e-8;
function receiptlessPreflightError(world,actor,row,receipts){
  const f=actor.physiology,profile=BIOLOGY_PROFILES[f.profile];
  const actionId=row.actionId,ingestion=canonicalNumberId(row.id,'ingestion');
  const object=canonicalNumberId(row.objectId,'object');
  const worldObjectHigh=world.environment?.ecology?.nextId;
  if(!profile||!Number.isSafeInteger(actionId)||actionId<=0||
      !Number.isSafeInteger(actor.memory?.nextId)||actionId>=actor.memory.nextId||
      ingestion===null||!Number.isSafeInteger(f.nextId)||ingestion>=f.nextId||
      object===null||!Number.isSafeInteger(worldObjectHigh)||object>=worldObjectHigh||
      !finiteTime(row.at)||row.at>actor.elapsed||row.at>world.elapsed||
      receipts.has(actionId)||
      actor.discovery.experiments.some(experiment=>experiment?.actionId===actionId||experiment?.ingestionId===row.id)||
      actor.discovery.effects.some(effect=>effect?.actionId===actionId||effect?.ingestionId===row.id))
    return 'The pending ingestion has a conflicting or invalid historical identity.';
  if(!finiteRange(row.originalMassGrams,0,profile.stomachCapacityGrams)||row.originalMassGrams<=0||
      !finiteRange(row.remainingMassGrams,0,row.originalMassGrams)||row.remainingMassGrams<=0||
      !finiteRange(row.originalKcal,0,50000)||!finiteRange(row.remainingKcal,0,row.originalKcal)||
      !finiteRange(row.absorbedKcal,0,50000)||row.remainingKcal+row.absorbedKcal>row.originalKcal+bodyEpsilon||
      !finiteRange(row.originalWaterMl,0,20000)||!finiteRange(row.remainingWaterMl,0,row.originalWaterMl)||
      !finiteRange(row.absorbedWaterMl,0,20000)||
      row.remainingWaterMl+row.absorbedWaterMl>row.originalWaterMl+bodyEpsilon||
      !finiteRange(row.harm,0,100)||!finiteRange(row.digestHours,.05,24)||
      !finiteRange(row.elapsedHours,0,24)||!finiteRange(row.toxicity,0,1)||
      ['feedbackSent','waterFeedbackSent','sustenanceFeedbackSent'].some(key=>typeof row[key]!=='boolean'))
    return 'The pending ingestion has invalid finite physical quantities.';
  const feedback=actor.physiology.feedback;
  for(const event of feedback.filter(item=>item?.ingestionId===row.id||item?.actionId===actionId)){
    const feedbackId=canonicalNumberId(event.id,'feedback');
    if(feedbackId===null||feedbackId>=f.nextId||
        event.ingestionId!==row.id||event.actionId!==actionId||event.objectId!==row.objectId||
        event.provenance!=='sampled'||!finiteTime(event.at)||
        event.at<row.at||event.at>actor.elapsed||event.at>world.elapsed)
      return 'Related feedback does not match the pending ingestion.';
  }
  return null;
}
function sameExact(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a),other=Object.keys(b);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&sameExact(a[key],b[key]));
}
function markedEnvelopeError(state){
  if(state?.version!==8||state.simulationMode!=='discovery'||
      !Array.isArray(state.agents)||state.agents.length!==2||
      new Set(state.agents.map(actor=>actor?.id)).size!==2||
      !AGENT_IDS.every(id=>state.agents.some(actor=>actor?.id===id)))return true;
  return state.agents.some(actor=>actor?.version!==4||actor.mode!=='discovery'||
    !Array.isArray(actor.physiology?.stomach)||!Array.isArray(actor.physiology.feedback)||
    !Array.isArray(actor.discovery?.experiments)||!Array.isArray(actor.discovery.effects)||
    !Array.isArray(actor.discovery.seenFeedback)||!Array.isArray(actor.memory?.experience));
}
function persistedEnvironmentView(environment){
  // Ecology uses feelings while running, but v8 does not persist that animal
  // presentation value. Every other environmental field must survive exactly.
  const copy=structuredClone(environment);
  for(const animal of copy.ecology?.animals||[])delete animal.feelings;
  return copy;
}
function persistedSensationView(sensation){
  // Rain details are calculated from the weather on each live perception tick.
  const {rain,rainfall,...stored}=sensation;
  return stored;
}
function sameTechniquesAcrossCountDerivation(live,canonical){
  if(!Array.isArray(live)||!Array.isArray(canonical)||live.length!==canonical.length)return false;
  return live.every((before,index)=>{
    const after=canonical[index];
    if(!before||!after||!Number.isInteger(before.successes)||before.successes<0||
        !Number.isInteger(after.successes)||after.successes<0||after.successes>before.successes)return false;
    const {successes:liveSuccesses,confidence:liveConfidence,...liveStable}=before;
    const {successes:savedSuccesses,confidence:savedConfidence,...savedStable}=after;
    if(!sameExact(liveStable,savedStable))return false;
    return liveConfidence===savedConfidence||
      liveConfidence==='supported'&&savedConfidence==='tentative'&&
        liveSuccesses>=2&&savedSuccesses<2;
  });
}
function sameTrialsAcrossUnobservedTail(live,canonical,discovery){
  if(!live||!canonical||typeof live!=='object'||typeof canonical!=='object'||
      Array.isArray(live)||Array.isArray(canonical)||
      !sameExact(Object.keys(live).sort(),Object.keys(canonical).sort()))return false;
  return Object.entries(live).every(([key,before])=>{
    const after=canonical[key];
    const [objectId]=key.split('|');
    if(discovery.observations[objectId]||
        !discovery.experiments.some(row=>`${row.targetId}|${row.primitive}`===key))
      return sameExact(before,after);
    if(!before||!after||!Number.isInteger(before.attempts)||before.attempts<0||
        !Number.isInteger(before.successes)||before.successes<0||
        !Number.isInteger(before.failures)||before.failures<0||
        before.successes+before.failures!==before.attempts||
        !Number.isFinite(before.seconds)||before.seconds<0||
        !Number.isInteger(after.attempts)||!Number.isInteger(after.successes)||
        !Number.isInteger(after.failures)||!Number.isFinite(after.seconds)||
        after.attempts>before.attempts||after.successes>before.successes||
        after.failures>before.failures||after.seconds>before.seconds)return false;
    const {attempts:_a,successes:_s,failures:_f,seconds:_d,...liveStable}=before;
    const {attempts:_aa,successes:_ss,failures:_ff,seconds:_dd,...savedStable}=after;
    return sameExact(liveStable,savedStable);
  });
}
function markedContinuityError(source,canonical,{fromDisk=false}={}){
  if(markedEnvelopeError(source)||canonical?.saveBlocked||saveProtectionReason(canonical)||
      fromDisk&&Object.hasOwn(source,'npc')||
      !fromDisk&&source.npc&&source.npc!==source.agents[0]||
      !sameExact(source.features,canonical.features)||
      !sameExact(source.cardinal,validateCardinal(source.cardinal,{restoring:false}))||
      !sameExact(canonical.cardinal,validateCardinal(source.cardinal,{restoring:fromDisk}))||
      !sameExact(source.community,canonical.community)||
      !sameExact(source.selectedAgentId,canonical.selectedAgentId)||
      !WORLD_CONTINUITY_FIELDS.filter(key=>key!=='environment').every(key=>sameExact(source[key],canonical[key]))||
      !(fromDisk?sameExact(source.environment,canonical.environment):
        sameExact(persistedEnvironmentView(source.environment),canonical.environment)))return true;
  if(fromDisk){
    // A written marked actor is already canonical. Check its entire persisted
    // envelope before restoration, which may append one interruption receipt
    // and retire optional history at the 400-row cap.
    const persisted=validateSave(source,{restoring:false});
    if(persisted.saveBlocked||saveProtectionReason(persisted))return true;
    return persisted.agents.some(actor=>{
      const before=source.agents.find(item=>item.id===actor.id);
      if(!before||Object.hasOwn(before,'interrupted')&&before.interrupted!==true||
          before.interrupted===true&&(before.active!==null||before.skillRun!==null))return true;
      const {interrupted:restartMarker,...stable}=before;
      return !sameExact(stable,actor);
    });
  }
  return canonical.agents.some(actor=>{
    const before=source.agents.find(item=>item.id===actor.id);
    return !before||
      !ACTOR_PHYSICAL_FIELDS.filter(key=>key!=='sensation'&&key!=='bodyMode')
        .every(key=>sameExact(before[key],actor[key]))||
      !(sameExact(before.bodyMode,actor.bodyMode)||
        before.active?.request?.type==='rest'&&before.bodyMode==='resting'&&
        before.physiology.sleep.state==='awake'&&actor.bodyMode==='awake')||
      !sameExact(persistedSensationView(before.sensation),actor.sensation)||
      // Practice and unobserved trial aggregates are reconstructed from the
      // retained experiment tail. Technique successes derive from its retained
      // witnesses. Keep their structure and every causal proof row exact.
      !DISCOVERY_CONTINUITY_FIELDS.filter(key=>
        key!=='practice'&&key!=='trials'&&key!=='techniques')
        .every(key=>sameExact(before.discovery[key],actor.discovery[key]))||
      !sameTrialsAcrossUnobservedTail(before.discovery.trials,actor.discovery.trials,before.discovery)||
      !sameTechniquesAcrossCountDerivation(before.discovery.techniques,actor.discovery.techniques)||
      !MEMORY_WRITE_FIELDS.every(key=>sameExact(before.memory[key],actor.memory[key]))||
      !before.social||!before.cognition||
      !['version','id','name','mode','preset','learning','seed','rng','epoch','collapseId',
        'rescuedCollapseId','riskCost','rescuePresentation','modelBudget','bodyFeedback']
        .every(key=>sameExact(before[key],actor[key]));
  });
}
const failedMigration=reason=>({ok:false,reason});

/** Read-only preflight for the one historical case where a sampled stomach
 * still has its exact action receipt but its experiment rotated out. The
 * returned bytes are only a candidate; the caller must independently back up
 * the current raw value and obtain an explicit paused commit before writing. */
export function prepareLegacyPendingMigration(rawString){
  try{
    if(typeof rawString!=='string'||!rawString||new TextEncoder().encode(rawString).length>MAX_MIGRATION_RAW_BYTES)
      return failedMigration('The saved data are missing or exceed the bounded migration size.');
    const raw=JSON.parse(rawString);
    if(raw?.version!==8||raw.simulationMode!=='discovery'||unsupportedRules(raw)||
        raw.features?.legacyPendingPhysicalOnly===1||raw.npc||
        !Array.isArray(raw.agents)||raw.agents.length!==2||
        new Set(raw.agents.map(actor=>actor?.id)).size!==2||
        !raw.agents.some(actor=>actor?.id==='aster')||!raw.agents.some(actor=>actor?.id==='mira'))
      return failedMigration('This save is not an eligible unmigrated discovery world.');
    const migrated=structuredClone(raw), migrations=[];
    for(const actor of migrated.agents){
      if(actor?.version!==4||actor.mode!=='discovery'||!Array.isArray(actor.physiology?.stomach)||
          !Array.isArray(actor.physiology.feedback)||!Array.isArray(actor.discovery?.experiments)||
          !Array.isArray(actor.discovery.effects)||!Array.isArray(actor.discovery.seenFeedback)||
          !Array.isArray(actor.memory?.experience)||retainedEffectProofError(actor))
        return failedMigration('A learned effect or actor record has incomplete evidence.');
      const profile=BIOLOGY_PROFILES[actor.physiology.profile];
      if(!profile||actor.physiology.stomach.length>BIOLOGY_RULES.maxDigestiveInputs||
          actor.physiology.feedback.length>BIOLOGY_RULES.maxFeedback||
          !finiteTime(actor.elapsed)||!finiteTime(migrated.elapsed)||
          actor.physiology.stomach.some(row=>!Number.isFinite(row?.remainingMassGrams)||row.remainingMassGrams<0)||
          actor.physiology.stomach.reduce((mass,row)=>mass+row.remainingMassGrams,0)>profile.stomachCapacityGrams+bodyEpsilon)
        return failedMigration('The saved digestive state exceeds its finite physical bounds.');
      const stomachIds=new Set(),stomachActions=new Set();
      for(const row of actor.physiology.stomach){
        if(typeof row?.id!=='string'||stomachIds.has(row.id)||
            positiveId(row.actionId)&&stomachActions.has(row.actionId))
          return failedMigration('Pending ingestion identities are not unique.');
        stomachIds.add(row.id);
        if(positiveId(row.actionId))stomachActions.add(row.actionId);
      }
      const receipts=new Map();
      for(const event of actor.memory.experience){
        if(!positiveId(event?.id)||receipts.has(event.id))return failedMigration('Action receipt identities are not unique.');
        receipts.set(event.id,event);
      }
      const experimentActions=new Set();
      for(const experiment of actor.discovery.experiments){
        if(!positiveId(experiment?.actionId)||experimentActions.has(experiment.actionId))
          return failedMigration('Experiment action identities are not unique.');
        experimentActions.add(experiment.actionId);
      }
      const feedbackIds=new Set();
      for(const feedback of actor.physiology.feedback){
        if(typeof feedback?.id!=='string'||!/^feedback:\d+$/.test(feedback.id)||feedbackIds.has(feedback.id))
          return failedMigration('Feedback identities are not unique.');
        feedbackIds.add(feedback.id);
        if(feedback.provenance===LEGACY_PHYSICAL_PROVENANCE||
            feedback.provenance===LEGACY_UNKNOWN_PHYSICAL_PROVENANCE)
          return failedMigration('The save already contains a migration marker.');
      }
      const seen=new Set(actor.discovery.seenFeedback);
      for(const row of actor.physiology.stomach){
        if(row?.provenance===LEGACY_PHYSICAL_PROVENANCE)
          return failedMigration('The save already contains a migration marker.');
        if(row?.provenance===LEGACY_UNKNOWN_PHYSICAL_PROVENANCE)
          return failedMigration('The save already contains a migration marker.');
        if(row?.provenance!=='sampled'||experimentActions.has(row.actionId))continue;
        const receipt=receipts.get(row.actionId),result=receipt?.details?.result;
        if(!receipt){
          const error=receiptlessPreflightError(migrated,actor,row,receipts);
          if(error)return failedMigration(error);
          const related=actor.physiology.feedback.filter(feedback=>
            feedback.ingestionId===row.id||feedback.actionId===row.actionId);
          row.provenance=LEGACY_UNKNOWN_PHYSICAL_PROVENANCE;
          for(const feedback of related)feedback.provenance=LEGACY_UNKNOWN_PHYSICAL_PROVENANCE;
          migrations.push({actorId:actor.id,ingestionId:row.id,actionId:row.actionId,
            objectId:row.objectId,proof:'receiptless-unknown'});
          continue;
        }
        if(!ingestionId(row.id)||!objectId(row.objectId)||!positiveId(row.actionId)||!finiteTime(row.at)||
            receipt?.type!=='action'||receipt.at!==row.at||
            receipt.details?.action?.type!=='sample'||receipt.details.action.targetId!==row.objectId||
            result?.ok!==true||result.code!=='SWALLOWED'||result.ingestionId!==row.id||
            actor.discovery.experiments.some(experiment=>experiment?.ingestionId===row.id)||
            actor.discovery.effects.some(effect=>effect?.ingestionId===row.id||effect?.actionId===row.actionId))
          return failedMigration('The pending ingestion has no exact, independent sample-action receipt.');
        const related=actor.physiology.feedback.filter(feedback=>
          feedback.ingestionId===row.id||feedback.actionId===row.actionId);
        if(related.some(feedback=>feedback.ingestionId!==row.id||feedback.actionId!==row.actionId||
            feedback.objectId!==row.objectId||feedback.provenance!=='sampled'||
            !finiteTime(feedback.at)||feedback.at<row.at))
          return failedMigration('Related feedback does not match the pending ingestion.');
        row.provenance=LEGACY_PHYSICAL_PROVENANCE;
        for(const feedback of related)if(!seen.has(feedback.id))feedback.provenance=LEGACY_PHYSICAL_PROVENANCE;
        migrations.push({actorId:actor.id,ingestionId:row.id,actionId:row.actionId,
          objectId:row.objectId,proof:'receipt-backed'});
      }
    }
    if(!migrations.length)return failedMigration('There is no eligible stomach-backed missing experiment.');
    migrated.features.legacyPendingPhysicalOnly=1;
    if(saveProtectionReason(migrated)||migrated.agents.some(actor=>!planProofRetention(actor).ok))
      return failedMigration('Another proof dependency remains incomplete; the original save stays protected.');
    const canonical=validateSave(migrated);
    if(canonical.saveBlocked||saveProtectionReason(canonical)||
        !WORLD_CONTINUITY_FIELDS.every(key=>sameExact(canonical[key],migrated[key])))
      return failedMigration('The dry-run restore would change this world’s physical state or progress.');
    const retiredEvents=[],restartEvents=[];
    for(const source of migrated.agents){
      const restored=canonical.agents.find(actor=>actor.id===source.id);
      if(!restored||!ACTOR_PHYSICAL_FIELDS.every(key=>sameExact(restored[key],source[key]))||
          !DISCOVERY_CONTINUITY_FIELDS.every(key=>sameExact(restored.discovery[key],source.discovery[key]))||
          !MEMORY_CONTINUITY_FIELDS.every(key=>sameExact(restored.memory[key],source.memory[key]))||
          !sameExact(restored.inventory?.items,source.inventory?.items))
        return failedMigration('The dry-run restore would change physical quantities or retained evidence.');
      const beforeIds=new Set(source.memory.experience.map(event=>event.id));
      const afterIds=new Set(restored.memory.experience.map(event=>event.id));
      retiredEvents.push(...source.memory.experience.filter(event=>!afterIds.has(event.id)).map(event=>
        ({actorId:source.id,id:event.id,type:event.type,code:event.details?.code||null})));
      restartEvents.push(...restored.memory.experience.filter(event=>!beforeIds.has(event.id)).map(event=>
        ({actorId:source.id,id:event.id,code:event.details?.result?.code||null})));
    }
    const {npc:historicalAlias,...saved}=canonical;
    const candidate=JSON.stringify(saved);
    const reopened=loadSave({getItem:()=>candidate});
    if(reopened.blocked||!reopened.exists||reopened.state.features?.legacyPendingPhysicalOnly!==1||
        !WORLD_CONTINUITY_FIELDS.every(key=>sameExact(reopened.state[key],migrated[key]))||
        reopened.state.agents.some(actor=>{
          const source=migrated.agents.find(item=>item.id===actor.id);
          return !source||!ACTOR_PHYSICAL_FIELDS.every(key=>sameExact(actor[key],source[key]))||
            !DISCOVERY_CONTINUITY_FIELDS.every(key=>sameExact(actor.discovery[key],source.discovery[key]))||
            !MEMORY_CONTINUITY_FIELDS.every(key=>sameExact(actor.memory[key],source.memory[key]));
        }))return failedMigration('The candidate would not survive a normal reopen.');
    return {ok:true,candidate,report:{migrations,retiredEvents,restartEvents}};
  }catch{
    return failedMigration('The save could not pass the bounded migration preflight.');
  }
}
