// A separate, persistent fresh world. The original and recovered valley boot
// modules are never imported here, and their save key is never opened.
import { CONFIG } from './config.js';
import { clockTime } from './world.js';
import { createOzarkWorldGeometry } from './ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave } from './ozark-save.js';
import { bindOzarkWorldAgent } from './ozark-agent-world.js';
import { OzarkWorldRenderer } from './ozark-world-renderer.js';
import { PopulationRuntime } from './population.js';
import { createNpcPanel } from './npc-panel.js';
import { bodySignals, sensedEnvironment } from './interoception.js';
import { environmentConditions, environmentHour } from './environment.js';
import { SimulationClock } from './simulation-clock.js';

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const title = value => String(value || '').replaceAll('-', ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase());
const geometry = createOzarkWorldGeometry();
const storage = window.localStorage;
const loaded = loadOzarkSave(storage, geometry);
let state = loaded.state;
let population = null;
let renderer = null;
let npcPanel = null;
let started = false;
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
function save(explicit = false) {
  if (loaded.blocked || !state) return false;
  const ok = writeOzarkSave(storage, state, geometry);
  text('save-status', ok ? 'Ozark world saved locally' : 'Ozark save unavailable');
  if (explicit) notify(ok ? 'The separate Ozark world was saved.' :
    'Saving failed. The previous Ozark save remains protected.', 8);
  if (!ok && started) {
    paused = true;
    keys.clear();
    show('pause-panel');
  }
  return ok;
}
async function openOriginal() {
  if (started && !save(true)) return;
  try {
    const result = await window.aincradWorld?.open('original');
    if (result?.ok !== true) throw new Error(result?.reason || 'The original world could not open.');
  } catch (error) {
    notify(error?.message || 'The original world could not open.', 8);
  }
}

document.title = 'Aincrad — Separate Ozark wilderness';
text('welcome-profile-label', loaded.blocked ?
  'Separate Ozark save protected · original world untouched' :
  loaded.exists ? 'Separate Ozark wilderness · saved world' :
    'Separate Ozark wilderness · fresh world');
text('active-profile-label', 'Ozark wilderness · separate local save');
text('begin', loaded.exists ? 'Continue the Ozark wilderness ↗' :
  'Begin a fresh Ozark wilderness ↗');
text('watch-aster', 'Watch Aster in Ozark ↗');
text('expedition-mode', 'OZARK · DISCOVERY');
text('nav-label', 'OZARK WILDERNESS');
text('location-kicker', 'A NEW LANDSCAPE');
text('map-title', 'The Ozark watershed');
text('atlas-fit', 'Whole watershed');
text('map-hint', 'The full landform is visible to you; agents remember only what they sense.');
text('pause-title', 'The Ozark world is paused.');
text('resume', 'Return to Ozark ↗');
const welcomeMode = $('welcome')?.querySelector('.welcome-mode');
if (welcomeMode) welcomeMode.textContent =
  'This new world has its own save. Your original and recovered expeditions are separate and unchanged.';
const welcomeCopy = $('welcome')?.querySelector('.welcome-copy > p:nth-of-type(2)');
if (welcomeCopy) welcomeCopy.textContent =
  'Explore an entire modeled watershed with Aster and Mira. They choose from local observations and learn only from their own actions.';
const welcomeControls = $('welcome')?.querySelector('.welcome-controls');
if (welcomeControls) welcomeControls.textContent =
  'WASD or arrows walk · hold Space to attempt swimming · hold G to attempt climbing · M opens the map';
const welcomeDetail = $('welcome')?.querySelector('.welcome-detail');
if (welcomeDetail) welcomeDetail.textContent = 'OZARK · FRESH WORLD · SEPARATE SAVE';
const help = $('help-panel')?.querySelector('.guide');
if (help) {
  const terms = help.querySelectorAll('dl dt');
  const entries = help.querySelectorAll('dl dd');
  if (entries[0]) entries[0].textContent = 'Walk through the Ozark watershed.';
  if (terms[2]) terms[2].textContent = 'Space / G';
  if (entries[2]) entries[2].textContent = 'Hold Space while moving to attempt swimming; hold G to attempt climbing. Both cost effort.';
  if (entries[3]) entries[3].textContent = 'Open the full watershed map. It shows the landform and all three people, and lets you place a waypoint.';
  terms[6]?.remove(); entries[6]?.remove();
  if (entries[7]) entries[7].textContent = 'Open the journal for Aster and Mira. Their own maps contain only their observations.';
  const paragraph = help.querySelector('dl + p');
  if (paragraph) paragraph.textContent =
    'River depth, current and slope are modeled game rules. Shallow water can be waded; deep water and steep ground require physical attempts. No bridges or camps are supplied.';
  const detail = help.querySelector('p.small');
  if (detail) detail.textContent =
    'Aster and Mira experiment with nearby objects and learn from physical outcomes. Their memories and the finite ecosystem save with this separate world.';
}
const atlasNote = $('map-panel')?.querySelector('.atlas-note');
if (atlasNote) atlasNote.textContent =
  'You can inspect the whole watershed. Aster and Mira use only their own observed and remembered local cells.';
$('atlas-map').setAttribute('aria-label',
  'Whole Ozark watershed map with live human locations. Scroll to zoom, drag to pan, and click to place a waypoint.');
const legend = $('map-panel')?.querySelector('.legend');
if (legend) for (const item of [...legend.children].slice(3, 5)) item.remove();
hide('open-cardinal'); hide('cardinal-panel'); hide('interaction');
hide('return-camp'); hide('new-expedition'); hide('pause-open-copy');
hide('welcome-ozark'); hide('welcome-open-copy');
show('welcome-original'); show('pause-original');
$('welcome-original').addEventListener('click', openOriginal);
$('pause-original').addEventListener('click', openOriginal);

if (loaded.blocked) {
  // A corrupt, unsupported or concurrently changed Ozark slot cannot create a
  // fresh replacement, run controllers or write another save over its bytes.
  state = { player: { ...geometry.spawn }, agents: [], selectedAgentId: 'aster',
    environment: { ecology: null }, elapsed: 0, waypoint: null };
  $('begin').disabled = true;
  $('watch-aster').disabled = true;
  show('recovery-panel'); show('recovery-original');
  text('recovery-title', 'The separate Ozark save is protected.');
  text('recovery-profile-label', 'Original world and recovered copy remain separate.');
  text('recovery-diagnosis', loaded.error || 'The Ozark save could not be safely validated.');
  text('recovery-migration', 'No Ozark simulation or save writes will run.');
  text('recovery-note', 'Keep this save for inspection. Return to the original world without replacing either world.');
  text('save-status', 'Ozark save protected');
  $('recovery-original').addEventListener('click', openOriginal);
} else {
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  population = new PopulationRuntime(state, { cardinal: false });
}
renderer = new OzarkWorldRenderer($('world'), geometry);
renderer.followId = 'aster';
renderer.snap(state.player);
if (population) {
  npcPanel = createNpcPanel({
    getNpc: selectedAgent, getAgents: () => state.agents,
    getController: () => population.controller(selectedAgent().id),
    getRuntime: () => population, getCommunity: () => state.community,
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
  if (loaded.blocked || started || !save()) return false;
  started = true;
  hide('welcome'); show('hud');
  keys.clear(); $('world').focus({ preventScroll: true });
  clock.reset(performance.now() / 1000);
  notify('Ozark is saved separately. Aster and Mira begin with no learned crossing skill.');
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
  if (!started) return;
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
  state.elapsed += dt;
  state.distance += motion.distance;
  population.tick(dt);
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
  const dt = clamp((now - lastFrame) / 1000, 0, .25);
  lastFrame = now;
  if (started && !paused) anim.time += dt;
  renderer.draw(state, anim);
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
setInterval(() => {
  clock.advance(performance.now() / 1000, {
    running: started && !paused && !loaded.blocked, speed: simulationSpeed,
  });
  if (started && performance.now() - lastAutosave > 10000) {
    lastAutosave = performance.now(); save();
  }
}, 1000 / 60);

$('begin').addEventListener('click', begin);
$('watch-aster').addEventListener('click', () => {
  if (begin()) { renderer.followNpc = true; renderer.followId = 'aster';
    renderer.snap(state.agents[0].position); }
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
if (location.search === '?test=1&ozarkWorld=1') {
  window.__ozarkWorld = Object.freeze({
    start: begin, save: () => save(true),
    step: (seconds, dx = 0, dy = 0, mode = 'walk') => {
      if (!started || !Number.isFinite(seconds) || seconds < 0 || seconds > 30 ||
          !Number.isFinite(dx) || !Number.isFinite(dy) ||
          Math.abs(dx) > 1 || Math.abs(dy) > 1 ||
          !['walk', 'climb', 'swim'].includes(mode)) return false;
      for (let elapsed = 0; elapsed < seconds; elapsed += CONFIG.fixedStep) {
        const dt = Math.min(CONFIG.fixedStep, seconds - elapsed);
        advancePlayer(dt, dx, dy, mode);
      }
      return true;
    },
    snapshot: () => ({ geometryIdentity: state.geometryIdentity,
      player: { ...state.player }, playerBody: { ...state.playerBody },
      agents: state.agents.map(npc => ({ id: npc.id, position: { ...npc.position },
        elapsed: npc.elapsed, memory: structuredClone(npc.memory),
        discovery: structuredClone(npc.discovery), physiology: structuredClone(npc.physiology) })),
      ecology: state.environment.ecology && {
        plants: state.environment.ecology.plants.length,
        animals: state.environment.ecology.animals.length,
        materials: state.environment.ecology.materials.length,
      }, elapsed: state.elapsed, saveStatus: $('save-status').textContent,
      started, paused, blocked: loaded.blocked }),
  });
}
