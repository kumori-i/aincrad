// The single supported Ozark world. Launch resumes valid current progress;
// historical save slots are never read, migrated, deleted or overwritten.
import { CONFIG } from './config.js';
import { clockTime } from './world.js';
import { createOzarkWorldGeometry } from './ozark-world-geometry.js';
import { loadOzarkSave, writeOzarkSave, getOzarkSaveFailure, OZARK_SAVE_KEY } from './ozark-save.js';
import { bindOzarkWorldAgent } from './ozark-agent-world.js';
import { OzarkWorldRenderer } from './ozark-world-renderer.js';
import { PopulationRuntime } from './population.js';
import { createNpcPanel } from './npc-panel.js';
import { survivalDecisionSnapshot } from './survival-decision-observer.js';
import { bodySignals, sensedEnvironment } from './interoception.js';
import { environmentConditions, environmentHour } from './environment.js';
import { SimulationClock } from './simulation-clock.js';
import { installWorldReset } from './world-reset-ui.js';
import { installCommunicationInspector } from './communication-inspector.js';
import { attachVisualReferenceLearning } from './visual-reference-attachment.js';
import { initialReferenceRandomStates } from './visual-reference-random.js';
import { createFreshCharacterMessages } from './visual-reference-save.js';
import { createCommunicationPixelSensor } from './communication-pixels.js';
import { saveFailureMessage } from './save-failure-message.js';
import { createVisualReferenceSaveGate } from './visual-reference-save-gate.js';

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const title = value => String(value || '').replaceAll('-', ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());
// Paint the noninteractive loading status before deterministic world generation.
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const storage = window.localStorage;
let geometry, loaded;
try {
  geometry = createOzarkWorldGeometry();
  // The isolated native reference fixture declares its historical blank seed.
  // Occupied slots ignore this option and retain their validated continuations.
  loaded = loadOzarkSave(storage, geometry,
    {communicationSeed: location.search === '?test=1' ? 211 : undefined});
} catch (error) {
  hide('world-loading'); show('recovery-panel');
  text('recovery-title', 'The world could not finish loading.');
  text('recovery-diagnosis', String(error?.message || error));
  text('recovery-note', 'No simulation has started and no saved bytes have been changed.');
  throw error;
}
let state = loaded.state;
let population = null;
let renderer = null;
let npcPanel = null;
let communicationInspector = null;
let communicationLearning = null;
const referenceSaveGate=createVisualReferenceSaveGate();
let communicationError = '';
// Capture completed personal learning before disposal can censor in-flight
// actions. If current memory cannot be validated, no ordinary save may replace
// the last good bytes with a blank or older learner checkpoint.
function stopCommunication() {
  const previous = communicationLearning;
  communicationLearning = null;
  referenceSaveGate.retire(previous);
  communicationError=referenceSaveGate.isBlocked()?
    'Character-message learning stopped after an error. Current learned memory could not be verified; ordinary saving is blocked to protect it.':
    'Character-message learning stopped after an error. Completed private learning is retained for saving; survival continues.';
  notify(communicationError, 12);
}
function communicate(method, ...args) {
  try { return ['optionalAction', 'performOptional', 'performed', 'decision'].includes(method)
    ? communicationLearning?.hooks[method](...args)
    : communicationLearning?.[method](...args); }
  catch { stopCommunication(); return null; }
}
let started = false;
// Runtime-only engineering ownership; never serialized or enabled in ordinary URLs.
let referenceFixtureOwner = null;
let resetHeld = false;
let resetRetired = false;
let paused = false;
let windowFocused = true;
let panel = null;
let simulationSpeed = 1;
let lastFrame = performance.now();
let lastHud = 0;
let lastAutosave = 0;
let lastMini = 0;
let lastAtlas = 0;
let toastUntil = 0;
let lastPlayerResult = null;
let previewPoint = null;
let previewHour = null;
let previewVersion = 0;
let renderedPreviewVersion = -1;
const previewViews = Object.freeze({spawn:geometry.spawn,forest:{x:0,y:3600},glade:{x:-11080.04,y:-6786.96},shore:{x:-1400,y:-400}});
const keys = new Set();
const anim = { time: 0, moving: false, facing: { x: 0, y: 1 } };
const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'KeyG']);

function text(id, value) { if ($(id)) $(id).textContent = value; }
function hide(id) { $(id)?.classList.add('hidden'); }
function show(id) { $(id)?.classList.remove('hidden'); }
function notify(message, seconds = 6) {
  text('toast', message); show('toast');
  toastUntil = performance.now() + seconds * 1000;
}
function selectedAgent() {
  return population?.getAgent(state.selectedAgentId) || state.agents?.[0] || null;
}
function save(explicit = false, referenceCheckpoint = false) {
  if(referenceFixtureOwner&&!referenceCheckpoint)return false;
  if (resetHeld || resetRetired || loaded.blocked || !state) return false;
  const reference=referenceSaveGate.current(communicationLearning);
  const ok=reference.ok&&writeOzarkSave(storage,state,geometry,{referencePersistence:reference.persistence});
  const failure=ok?'':!reference.ok?
    'Saving is blocked because current visual learning could not be safely exported. Your previous saved bytes remain protected.':
    saveFailureMessage(getOzarkSaveFailure(state));
  text('save-status', ok ? 'Ozark world saved locally' : failure);
  text('pause-save-failure', failure);
  if (explicit) notify(ok ? 'The world was saved.' : failure, 12);
  if (!ok && started) {
    paused = true;
    keys.clear();
    show('pause-panel');
  }
  return ok;
}
document.title = 'Aincrad — Ozark wilderness';
text('active-profile-label', 'Ozark wilderness · local save');
text('expedition-mode', 'OZARK · DISCOVERY');
text('nav-label', 'OZARK WILDERNESS');
text('location-kicker', 'A NEW LANDSCAPE');
text('map-title', 'The Ozark watershed');
text('atlas-fit', 'Whole watershed');
text('map-hint', 'The full landform is visible to you; agents remember only what they sense.');
text('pause-title', 'The Ozark world is paused.');
text('resume', 'Return to Ozark ↗');
const atlasNote = $('map-panel')?.querySelector('.atlas-note');
if (atlasNote) atlasNote.textContent =
  'You can inspect the whole watershed. Aster and Mira use only their own observed and remembered local cells.';
$('atlas-map').setAttribute('aria-label',
  'Whole Ozark watershed map with live human locations. Scroll to zoom, drag to pan, and click to place a waypoint.');
hide('interaction');

if (loaded.blocked) {
  // A corrupt, unsupported or concurrently changed Ozark slot cannot create a
  // fresh replacement, run controllers or write another save over its bytes.
  state = { player: { ...geometry.spawn }, agents: [], selectedAgentId: 'aster',
    environment: { ecology: null }, elapsed: 0, waypoint: null };
  show('recovery-panel');
  text('recovery-title', 'The current world save is protected.');
  text('recovery-profile-label', 'No saved bytes were changed.');
  text('recovery-diagnosis', loaded.error || 'The Ozark save could not be safely validated.');
  text('recovery-migration', 'No Ozark simulation or save writes will run.');
  text('recovery-note', 'Keep this save for inspection. It will not be overwritten automatically. Reset world is an explicit, destructive choice.');
  text('save-status', 'Ozark save protected');
} else {
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  let sensor = null;
  try {
    sensor = createCommunicationPixelSensor(document);
    communicationLearning = attachVisualReferenceLearning({ state, pixelSensor: sensor, protocol: 'sequence' });
  } catch {
    sensor?.dispose(); stopCommunication();
  }
  population = new PopulationRuntime(state, { cardinal: false, experimentalDiscovery: {
    optionalAction: (...args) => communicate('optionalAction', ...args),
    performOptional: (...args) => communicate('performOptional', ...args),
    decision: (...args) => communicate('decision', ...args),
    performed: (...args) => communicate('performed', ...args),
  } });
}
renderer = new OzarkWorldRenderer($('world'), geometry);
try {
  await renderer.prepareAtlas();
} catch (error) {
  hide('world-loading'); show('recovery-panel');
  text('recovery-title', 'The world could not finish loading.');
  text('recovery-diagnosis', String(error?.message || error));
  text('recovery-note', 'No simulation has started. Existing saved bytes have not been changed.');
  throw error;
}
hide('world-loading');
renderer.followId = 'aster';
renderer.snap(state.player);
if (population) {
  npcPanel = createNpcPanel({
    getNpc: selectedAgent, getAgents: () => state.agents,
    getController: () => population.controller(selectedAgent().id),
    getRuntime: () => population, getCommunity: () => state.community,
    getLearning: () => communicationLearning, getLearningError: () => communicationError,
    onClose: () => { if(paused && !resetHeld && !resetRetired) show('pause-panel'); },
    selectAgent: id => {
      if (!population.getAgent(id)) return;
      state.selectedAgentId = id; renderer.followId = id;
      if (renderer.followNpc) renderer.snap(selectedAgent().position);
      save();
    },
    renderer, getEnvironment: () => state.environment, save: () => save(), notify,
  });
}

function begin() {
  if (referenceFixtureOwner || resetHeld || resetRetired || loaded.blocked || started || !save()) return false;
  started = true;
  show('hud');
  keys.clear(); $('world').focus({ preventScroll: true });
  clock.reset(performance.now() / 1000);
  if (!loaded.exists) notify('Aster and Mira begin exploring. Press N to inspect their observations and character messages.');
  return true;
}
function closePanel() {
  if (panel) hide(panel + '-panel');
  panel = null; keys.clear(); $('world').focus({ preventScroll: true });
}
function openPanel(name) {
  if (!started || loaded.blocked) return;
  closePanel(); panel = name; show(name + '-panel');
  if (name === 'map') updateAtlas();
  $(name + '-panel').querySelector('button')?.focus();
}
function togglePanel(name) { if (panel === name) closePanel(); else openPanel(name); }
function setPause(value) {
  if (!started || resetHeld || resetRetired) return;
  paused = value; keys.clear(); anim.moving = false;
  clock.reset(performance.now() / 1000);
  if (value) { closePanel(); show('pause-panel'); $('resume').focus(); }
  else { hide('pause-panel'); $('world').focus({ preventScroll: true }); }
}
function updateAtlas() {
  renderer.drawAtlas($('atlas-map'), state);
  const status = renderer.atlasStatus();
  text('atlas-zoom-label', `${status.zoom.toFixed(1)}×`);
}

function advancePlayer(dt, dx, dy, mode, sprint = false) {
  const acting = Boolean(dx || dy);
  const start = { ...state.player };
  const motion = geometry.advance(state.player, dx, dy, dt, sprint, mode);
  const body = state.playerBody;
  const wet = motion.waterSeconds;
  body.wetness = clamp(body.wetness + wet * 18 - (dt - wet) * 2, 0, 100);
  body.effort = clamp(body.effort + motion.effortSeconds * .065 - dt * .025, 0, 1);
  body.stamina = clamp(body.stamina - motion.effortSeconds * 2.4 +
    (!acting ? dt * 1.2 : 0), 0, 100);
  if (motion.fallRiskSeconds > 0) body.health = clamp(body.health -
    motion.fallRiskSeconds * 8, 0, 100);
  if (motion.swimSeconds > 0 && body.stamina < 1)
    body.health = clamp(body.health - motion.swimSeconds * 2, 0, 100);
  communicate('beforeTick');
  state.elapsed += dt;
  state.distance += motion.distance;
  population.tick(dt);
  communicate('afterTick');
  anim.moving = motion.distance > .01;
  if (acting) {
    const length = Math.hypot(dx, dy);
    anim.facing = { x: dx / length, y: dy / length };
    const along = ((state.player.x - start.x) * dx +
      (state.player.y - start.y) * dy) / length;
    const swimTime = Math.min(dt, motion.swimSeconds);
    const climbTime = Math.min(dt - swimTime, motion.climbSeconds);
    const wadeTime = Math.min(dt - swimTime - climbTime,
      Math.max(0, motion.waterSeconds - swimTime));
    const dryTime = Math.max(0, dt - swimTime - climbTime - wadeTime);
    const expected = CONFIG.walkSpeed * (
      dryTime * (sprint ? CONFIG.sprintMultiplier : 1) +
      wadeTime * geometry.profile.wadeWalkMultiplier +
      climbTime * geometry.profile.climbSpeedMultiplier +
      swimTime * geometry.profile.swimSpeedMultiplier);
    lastPlayerResult = {
      at: state.elapsed, mode,
      progress: along < expected * .15 ? 'negligible' :
        along < expected * .8 ? 'limited' : 'steady',
      footing: motion.footing, wetness: wet > 0 ? 'wetter' : 'drying',
      effort: motion.effortSeconds > 0 ? 'rising' : 'steady',
      fallRisk: motion.fallRiskSeconds > 0,
    };
  }
}
function fixedStep(dt) {
  if(referenceFixtureOwner)return;
  const dx = Number(keys.has('KeyD') || keys.has('ArrowRight')) -
    Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const dy = Number(keys.has('KeyS') || keys.has('ArrowDown')) -
    Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const acting = windowFocused && !panel &&
    $('npc-panel').classList.contains('hidden');
  const mode = keys.has('Space') ? 'swim' : keys.has('KeyG') ? 'climb' : 'walk';
  advancePlayer(dt, acting ? dx : 0, acting ? dy : 0, mode,
    keys.has('ShiftLeft') || keys.has('ShiftRight'));
}
const clock = new SimulationClock({ step: CONFIG.fixedStep, onStep: fixedStep });
clock.reset(performance.now() / 1000);

function updateHud(now) {
  if (!started || now - lastHud < 150) return;
  lastHud = now;
  const viewed = renderer.viewSubject(state);
  const site = geometry.observe(viewed);
  const time = clockTime(state.elapsed);
  const hour = environmentHour(state.environment);
  const minute = Math.floor(hour * 60);
  text('clock', `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
  text('day', `DAY ${String(time.day).padStart(2, '0')}`);
  text('region', title(site.habitat));
  const subject = renderer.followNpc ? selectedAgent() : null;
  const conditions = environmentConditions(state.environment, {
    position: viewed, scene: 'valley', thermal: subject?.thermal,
  });
  const sensed = sensedEnvironment({ sensation: conditions });
  text('world-weather', `${sensed.weather} · ${sensed.warmth} · ${sensed.wind}`);
  const body = state.playerBody;
  const playerCondition = body.wetness > 45 ? 'soaked' :
    body.wetness > 2 ? 'wet' : 'dry';
  text('location-kicker', renderer.followNpc ?
    `${selectedAgent().name.toUpperCase()}’S JOURNEY` : 'YOUR FOOTSTEPS');
  text('location-detail', `${title(site.ground)} · ${playerCondition} · ${Math.round(body.stamina)} stamina${lastPlayerResult ? ` · ${title(lastPlayerResult.mode)} ${lastPlayerResult.progress}` : ''}`);
  const waypoint = state.waypoint;
  $('waypoint-hud').classList.toggle('hidden', !waypoint);
  if (waypoint) text('waypoint-hud',
    `Waypoint · ${Math.round(Math.hypot(waypoint.x - viewed.x, waypoint.y - viewed.y))} world units direct`);
}
function frame(now) {
  if (resetRetired) return;
  const dt = clamp((now - lastFrame) / 1000, 0, .25);
  lastFrame = now;
  if (started && !paused) anim.time += dt;
  const renderState = previewPoint && paused ? { ...state, player: previewPoint,
    environment: previewHour === null ? state.environment : { ...state.environment,
      settings: { ...state.environment.settings, hourOverride: previewHour } } } : state;
  renderer.draw(renderState, anim);
  renderedPreviewVersion = previewVersion;
  if (started) {
    npcPanel?.update(now / 1000);
    if (now - lastMini > 700) { lastMini = now; renderer.drawMini($('minimap'), state); }
    if (panel === 'map' && now - lastAtlas > 400) {
      lastAtlas = now; updateAtlas();
    }
    updateHud(now);
  }
  if (now > toastUntil) hide('toast');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const simulationTimer = setInterval(() => {
  clock.advance(performance.now() / 1000, {
    running: started && !referenceFixtureOwner && !paused && !loaded.blocked && !resetHeld && !resetRetired, speed: simulationSpeed,
  });
  if (started && !referenceFixtureOwner && performance.now() - lastAutosave > 10000) {
    lastAutosave = performance.now(); save();
  }
}, 1000 / 60);

communicationInspector = installCommunicationInspector({
  document, window, geometry, state,
  getLearning: () => communicationLearning, getError: () => communicationError,
  setPaused: setPause, isPaused: () => paused,
  canOpen: () => started && paused && !loaded.blocked && !resetHeld && !resetRetired,
  openLearning: () => { hide('pause-panel'); npcPanel?.openLearning(); },
  closeLearning: () => npcPanel?.close(), learningVisible: () => !!npcPanel?.isVisible(),
  onEnter: () => { keys.clear(); anim.moving = false; },
  onExit: () => { keys.clear(); },
});

installWorldReset({
  document, storage, geometry, previous: () => loaded.blocked ? null : state,
  freeze: () => {
    if (started) setPause(true);
    npcPanel?.close();
    resetHeld = true; keys.clear(); anim.moving = false;
  },
  release: () => { resetHeld = false; },
  retire: () => {
    resetRetired = true; started = false; paused = true; keys.clear();
    clearInterval(simulationTimer); communicationInspector?.dispose(); communicationLearning?.dispose(); population?.dispose();
  },
  reload: () => window.aincradWorldSave?.reloadCurrentWorld
    ? window.aincradWorldSave.reloadCurrentWorld() : location.reload(),
  exportCurrentWorld: window.aincradWorldSave?.exportCurrentWorld,
});

$('open-map').addEventListener('click', () => togglePanel('map'));
$('close-map').addEventListener('click', closePanel);
$('help-button').addEventListener('click', () => togglePanel('help'));
$('close-help').addEventListener('click', closePanel);
$('resume').addEventListener('click', () => setPause(false));
$('save-button').addEventListener('click', () => save(true));
$('simulation-speed').addEventListener('change', event => {
  const speed = Number(event.target.value);
  if ([1, 4, 16, 60].includes(speed)) {
    simulationSpeed = speed; clock.reset(performance.now() / 1000); keys.clear();
  }
});
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
    event.preventDefault(); if (started) save(true); return;
  }
  if (!started) return;
  if (event.code === 'Escape') {
    event.preventDefault(); if (!event.repeat) setPause(!paused); return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (event.code === 'KeyN') {
    event.preventDefault(); keys.clear(); npcPanel?.toggle(); return;
  }
  if (event.code === 'KeyM') {
    event.preventDefault(); if (!event.repeat) togglePanel('map'); return;
  }
  if (event.code === 'KeyH') {
    event.preventDefault(); if (!event.repeat) togglePanel('help'); return;
  }
  if (panel === 'map' && ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(event.code)) {
    event.preventDefault(); renderer.atlasZoom(['Equal', 'NumpadAdd'].includes(event.code) ? 1.35 : 1 / 1.35);
    updateAtlas(); return;
  }
  if (!paused && !panel && movementCodes.has(event.code) &&
      !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
function clearInput() { keys.clear(); anim.moving = false; }
window.addEventListener('blur', () => { windowFocused = false; clearInput(); });
window.addEventListener('focus', () => { windowFocused = true; clearInput(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
window.aincradAgent?.onWindowActive?.(active => {
  windowFocused = active; clearInput();
});
window.addEventListener('resize', () => renderer.resize());
window.addEventListener('pagehide', () => { if (started) save(); });
window.addEventListener('beforeunload', () => { if (started) save(); });

const atlas = $('atlas-map');
function atlasPoint(event) {
  const rect = atlas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * atlas.width,
    y: (event.clientY - rect.top) / rect.height * atlas.height };
}
let gesture = null;
atlas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  gesture = { id: event.pointerId, at: atlasPoint(event), moved: false };
  atlas.setPointerCapture(event.pointerId);
});
atlas.addEventListener('pointermove', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const at = atlasPoint(event);
  if (Math.hypot(at.x - gesture.at.x, at.y - gesture.at.y) > 2) gesture.moved = true;
  if (gesture.moved) { renderer.atlasPan(at.x - gesture.at.x, at.y - gesture.at.y);
    updateAtlas(); }
  gesture.at = at;
});
atlas.addEventListener('pointerup', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const moved = gesture.moved;
  gesture = null;
  if (atlas.hasPointerCapture(event.pointerId)) atlas.releasePointerCapture(event.pointerId);
  if (moved) return;
  const point = atlasPoint(event);
  const marker = renderer.atlasMarkerAt(point.x, point.y);
  if (marker) { renderer.atlasCenter(marker, state); updateAtlas(); return; }
  const world = renderer.atlasPoint(point.x, point.y);
  if (!world || !geometry.canOccupy(world.x, world.y)) return;
  state.waypoint = world; updateAtlas(); save();
});
atlas.addEventListener('contextmenu', event => {
  event.preventDefault(); state.waypoint = null; updateAtlas(); save();
});
atlas.addEventListener('wheel', event => {
  event.preventDefault(); const point = atlasPoint(event);
  renderer.atlasZoom(Math.exp(-event.deltaY * .0015), point.x, point.y);
  updateAtlas();
}, { passive: false });
for (const [id, factor] of [['atlas-zoom-in', 1.35], ['atlas-zoom-out', 1 / 1.35]])
  $(id).addEventListener('click', () => { renderer.atlasZoom(factor); updateAtlas(); });
$('atlas-fit').addEventListener('click', () => { renderer.atlasFit(); updateAtlas(); });
for (const id of ['you', 'aster', 'mira'])
  $('atlas-center-' + id).addEventListener('click', () => {
    renderer.atlasCenter(id, state); updateAtlas();
  });

// Local test hooks exist only in a disposable native test profile.
if (['?test=1','?test=1&smoke=1'].includes(location.search)) {
  window.__ozarkWorld = Object.freeze({
    start: begin, pause: () => setPause(true), save: () => save(true),
    // The reviewed native engineering harness supplies this installer directly;
    // no provider, saved data, message or agent action can enter this test route.
    referenceFixture: async (install, options={}) => {
      const optionKeys=options&&typeof options==='object'&&!Array.isArray(options)?Object.keys(options):null;
      if(!optionKeys||!(optionKeys.length===0||optionKeys.length===1&&
          optionKeys[0]==='negativeControlSeed'&&options.negativeControlSeed===212))return null;
      if(location.search!=='?test=1'||referenceFixtureOwner||started||loaded.exists||loaded.blocked||
        state.elapsed!==0||!population||!communicationLearning||typeof install!=='function')return null;
      try{if(storage.getItem(OZARK_SAVE_KEY)!==null)return null;}catch{return null;}
      const owner={steps:0,failed:false,advancing:false,checkpointAttempted:false};referenceFixtureOwner=owner;keys.clear();
      const step=()=>{
        if(referenceFixtureOwner!==owner||owner.failed||owner.advancing||owner.steps>=1200||
          started||Math.abs(state.elapsed-owner.steps*CONFIG.fixedStep)>1e-7)return false;
        owner.advancing=true;
        try{advancePlayer(CONFIG.fixedStep,0,0,'walk');owner.steps++;return true;}
        catch(error){owner.failed=true;communicationLearning?.censorPending();throw error;}
        finally{owner.advancing=false;}
      };
      // Only the reviewed installer closure gets this one-shot persistence
      // exception, for explicit isolated mid-action save/reopen verification.
      const checkpoint=()=>{
        if(referenceFixtureOwner!==owner||owner.failed||owner.advancing||owner.checkpointAttempted||
          owner.steps<=0||started||Math.abs(state.elapsed-owner.steps*CONFIG.fixedStep)>1e-7)return false;
        owner.checkpointAttempted=true;
        return save(false,true);
      };
      try{
        if(options.negativeControlSeed===212){
          // Deliberate engineering negative control on a blank disposable test
          // profile. Stream arithmetic fixes a wrong first exploratory choice;
          // no saved world, association, body or ordinary route is altered.
          if(state.visualReference?.seed!==211||state.visualReference.learners.some(row=>row.anchors.length||row.partners.length)||
              state.characterMessages?.learners.some(row=>row.sender.emissions||row.sender.updates||
                row.partners.some(partner=>partner.listener.demonstrations)))
            throw new Error('Negative control requires a fresh blank reference learner');
          communicationLearning.dispose();
          state.visualReference={...state.visualReference,seed:212,random:initialReferenceRandomStates(212)};
          state.characterMessages=createFreshCharacterMessages(state.worldLineage,state.visualReference);
          communicationLearning=attachVisualReferenceLearning({state,pixelSensor:createCommunicationPixelSensor(document),seed:212,protocol:'sequence'});
        }
        const readAssociation=communicationLearning.createNativeAssociationAuditReader();
        const auditAssociation=()=>{
          if(referenceFixtureOwner!==owner||owner.failed||owner.advancing||started||
            Math.abs(state.elapsed-owner.steps*CONFIG.fixedStep)>1e-7)return null;
          return readAssociation?.()??null;
        };
        return await install(Object.freeze({state,populationState:population.state,
          reference:communicationLearning,geometry,renderer,fixedStep:CONFIG.fixedStep,step,checkpoint,auditAssociation}));
      }
      catch(error){owner.failed=true;communicationLearning?.censorPending();throw error;}
    },
    referenceFixtureState:()=>referenceFixtureOwner?{owned:true,steps:referenceFixtureOwner.steps,failed:referenceFixtureOwner.failed,checkpointAttempted:referenceFixtureOwner.checkpointAttempted}:null,
    step: (seconds, dx = 0, dy = 0, mode = 'walk') => {
      if (referenceFixtureOwner || !started || paused || !Number.isFinite(seconds) || seconds < 0 || seconds > 30 ||
          !Number.isFinite(dx) || !Number.isFinite(dy) ||
          Math.abs(dx) > 1 || Math.abs(dy) > 1 ||
          !['walk', 'climb', 'swim'].includes(mode)) return false;
      for (let elapsed = 0; elapsed < seconds; elapsed += CONFIG.fixedStep) {
        const dt = Math.min(CONFIG.fixedStep, seconds - elapsed);
        advancePlayer(dt, dx, dy, mode);
      }
      return true;
    },
    preview: (name, hour = null) => {
      if (!paused || name !== null && !Object.hasOwn(previewViews,name) ||
          hour !== null && (!Number.isFinite(hour) || hour < 0 || hour >= 24)) return false;
      previewPoint = name === null ? null : {...previewViews[name]};
      previewHour = name === null ? null : hour;
      previewVersion++;
      renderer.followNpc = false; renderer.snap(previewPoint || state.player); return true;
    },
    detailReady: () => renderedPreviewVersion === previewVersion && renderer.pendingChunks.size === 0,
    fullSnapshot: () => structuredClone(state),
    communicationSnapshot: () => communicationLearning?.snapshot() ?? null,
    // Test-only yes/no lifecycle probe. It exposes no partner rows, targets,
    // poses, or learner inputs, and never creates a new observation.
    gestureMemoryEmpty: () => location.search === '?test=1' && state?.agents?.length === 2 &&
      state.agents.every(actor => communicationLearning?.readGestureMemory(actor)?.records.length === 0),
    gesturePredictionEmpty: () => location.search === '?test=1' && state?.agents?.length === 2 &&
      state.agents.every(actor => {
        const prediction=communicationLearning?.readGesturePrediction(actor);
        return prediction && !prediction.pending && prediction.forecasts === 0 &&
          prediction.validTargets === 0 && prediction.updates === 0;
      }),
    communicationMeasurementSnapshot: () => {
      if(location.search!=='?test=1')return null;
      const measurement=communicationLearning?.measurementSnapshot();
      if(!measurement)return null;
      return {...measurement,survival:state.agents.map(actor=>{
        const summary=survivalDecisionSnapshot(actor);
        return {agentId:actor.id,counters:summary.counters,gateCounts:summary.gateCounts,
          recordsRetained:summary.records.length,decisionActive:summary.active,
          body:{...summary.body,waterDeficitMl:actor.physiology.waterDeficitMl,
            stamina:actor.physiology.stamina},
          stats:{collapses:actor.stats.collapses,rescues:actor.stats.rescues,
            foodFeedbackEvents:actor.stats.independentMeals,drinks:actor.stats.independentDrinks},
          activeAction:actor.active?.request?.type??null};
      })};
    },
    referencePersistenceProbe: args => communicationLearning?.inspectPersistedAssociation(args) ?? null,
    survivalSnapshot: () => location.search === '?test=1' ? survivalDecisionSnapshot(state.agents.find(actor => actor.id === state.selectedAgentId)) : null,
    communicationError: () => communicationError,
    communicationBoundaryProbe: () => {
      if(!population || started&&!paused) return null;
      const actor=state.agents[0];
      return {mode:population.communicationMode,
        attempts:['say','ask','journalReply','writeNote','readNote'].map(method=>population.social[method](actor,{text:'native boundary probe',targetId:state.agents[1]?.id})),
        human:population.social.postUserMessage('native boundary probe')};
    },
    snapshot: () => ({ version:state.version,features:structuredClone(state.features),geometryIdentity: state.geometryIdentity,
      player: { ...state.player }, playerBody: { ...state.playerBody },
      agents: state.agents.map(npc => ({ id: npc.id, position: { ...npc.position },
        elapsed: npc.elapsed, memory: structuredClone(npc.memory),
        discovery: structuredClone(npc.discovery), physiology: structuredClone(npc.physiology) })),
      ecology: state.environment.ecology && {
        plants: state.environment.ecology.plants.length,
        animals: state.environment.ecology.animals.length,
        materials: state.environment.ecology.materials.length,
        fish: state.environment.ecology.aquatic.fish.length,
      }, elapsed: state.elapsed, saveStatus: $('save-status').textContent,
      ready: true, started, paused, blocked: loaded.blocked }),
  });
}

// Ordinary launches run immediately, without a world or start chooser. The
// disposable native test route waits for start() to inspect exact disk state.
if (location.search !== '?test=1' && !loaded.blocked) begin();
