import { CONFIG } from './config.js';
import { OZARK_WALKING_PILOT_PROFILE } from './geometry-profile.js';
import { createOzarkWalkingPilot } from './ozark-pilot-geometry.js';
import { PilotRenderer } from './ozark-pilot-renderer.js';
import { SimulationClock } from './simulation-clock.js';

// This module is entered only through the exact disposable-profile test URL.
// It constructs a fresh walking session without loading the normal game boot,
// saved worlds, NPC runtime, ecology, or persistence code.
const $ = id => document.getElementById(id);
const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);
const state = { player: { ...geometry.spawn }, elapsed: 0 };
const renderer = new PilotRenderer($('world'), geometry);
const anim = { time: 0, moving: false, facing: { x: 0, y: 1 } };
const keys = new Set();
const movementCodes = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);
let started = false;
let paused = false;
let windowFocused = true;
let observation = geometry.observe(state.player);
let lastFrame = performance.now();
let lastHud = 0;
let toastUntil = 0;

function hide(id) { $(id)?.classList.add('hidden'); }
function text(id, value) { if ($(id)) $(id).textContent = value; }
function title(value) { return value.replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function notify(message, seconds = 5) {
  text('toast', message);
  $('toast').classList.remove('hidden');
  toastUntil = performance.now() + seconds * 1000;
}

document.title = 'Aincrad — Unsaved Ozark walking pilot';
text('welcome-profile-label', 'Isolated walking pilot · no progress is saved');
text('active-profile-label', 'Fresh Ozark walking pilot · unsaved');
text('begin', 'Walk the Ozark pilot ↗');
text('save-status', 'Unsaved walking pilot');
text('expedition-mode', 'WALKING PILOT');
text('location-kicker', 'ONE BOUNDED OZARK CORRIDOR');
text('nav-label', 'OZARK PILOT');
text('pause-title', 'Pilot paused');
text('resume', 'Resume walking ↗');
const buildLabel = document.querySelector('.welcome .build');
if (buildLabel) buildLabel.textContent = 'OZARK WALKING PILOT';
const welcomeCopy = $('welcome')?.querySelector('.welcome-copy > p:nth-of-type(2)');
if (welcomeCopy) welcomeCopy.textContent =
  'Explore a small dry corridor of the approved Ozark map. Water and steep ground block this first walking trial.';
const welcomeMode = $('welcome')?.querySelector('.welcome-mode');
if (welcomeMode) welcomeMode.textContent =
  'This is an isolated, fresh session. Closing it discards all pilot progress.';
const welcomeControls = $('welcome')?.querySelector('.welcome-controls');
if (welcomeControls) welcomeControls.textContent =
  'WASD or arrow keys to walk · hold Shift to run · Esc to pause';
const welcomeDetail = $('welcome')?.querySelector('.welcome-detail');
if (welcomeDetail) welcomeDetail.textContent = 'OZARK · WALKING ONLY · UNSAVED';
const welcomeFoot = $('welcome')?.querySelector('.welcome-foot span:last-child');
if (welcomeFoot) welcomeFoot.textContent = 'Disposable test session · walking only';
const pauseIntro = $('pause-panel')?.querySelector('.menu-card > p:first-of-type');
if (pauseIntro) pauseIntro.textContent =
  'Escape pauses this walking session. Movement stops when the window loses focus.';
const pauseCopy = $('pause-panel')?.querySelector('.menu-card > p:last-child');
if (pauseCopy) pauseCopy.textContent =
  'The walking pilot cannot be saved. Closing this session discards its progress.';
const fatalCopy = $('fatal')?.querySelector('.menu-card > p');
if (fatalCopy) fatalCopy.textContent =
  'This pilot is unsaved. Close and restart the isolated test session.';
for (const id of [
  'watch-aster', 'welcome-open-copy', 'npc-short', 'open-npc',
  'open-cardinal', 'help-button', 'interaction', 'waypoint-hud',
  'map-panel', 'help-panel', 'npc-panel', 'cardinal-panel',
  'save-button', 'return-camp', 'pause-open-copy', 'pause-copy-note',
  'new-expedition',
]) hide(id);
document.querySelector('.navigation')?.classList.add('hidden');
document.querySelector('.time-note')?.classList.add('hidden');
for (const control of document.querySelectorAll('.simulation-controls label, .simulation-controls select')) {
  control.classList.add('hidden');
}
renderer.snap(state.player);

function updateHud() {
  observation = geometry.observe(state.player);
  text('region', title(observation.habitat));
  text('location-detail', `${title(observation.ground)} · ${observation.nearby.length} local sight lines`);
  text('world-weather', `Ground: ${title(observation.ground)}`);
  const seconds = Math.floor(state.elapsed);
  text('clock', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
  text('day', 'UNSAVED');
}
updateHud();

function begin() {
  if (started) return true;
  started = true;
  $('welcome').classList.add('hidden');
  $('hud').classList.remove('hidden');
  keys.clear();
  $('world').focus({ preventScroll: true });
  clock.reset(performance.now() / 1000);
  notify('Unsaved walking pilot. Stay within the dry corridor.');
  return true;
}

function setPause(value) {
  paused = value;
  keys.clear();
  anim.moving = false;
  clock.reset(performance.now() / 1000);
  $('pause-panel').classList.toggle('hidden', !paused);
  if (paused) $('resume').focus();
  else $('world').focus({ preventScroll: true });
}

function fixedStep(dt) {
  const dx = !windowFocused ? 0 :
    Number(keys.has('KeyD') || keys.has('ArrowRight')) -
    Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const dy = !windowFocused ? 0 :
    Number(keys.has('KeyS') || keys.has('ArrowDown')) -
    Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const travelled = geometry.move(state.player, dx, dy, dt,
    keys.has('ShiftLeft') || keys.has('ShiftRight'));
  anim.moving = travelled > .01;
  if (dx || dy) {
    const length = Math.hypot(dx, dy);
    anim.facing = { x: dx / length, y: dy / length };
  }
  state.elapsed += dt;
}

const clock = new SimulationClock({ step: CONFIG.fixedStep, onStep: fixedStep });
clock.reset(performance.now() / 1000);
setInterval(() => clock.advance(performance.now() / 1000, {
  running: started && !paused, speed: 1,
}), 1000 / 60);

function frame(now) {
  const dt = Math.min(Math.max(0, (now - lastFrame) / 1000), .25);
  lastFrame = now;
  if (started && !paused && anim.moving) anim.time += dt;
  renderer.draw(state, anim);
  if (started && now - lastHud >= 150) {
    lastHud = now;
    updateHud();
  }
  if (now > toastUntil) $('toast').classList.add('hidden');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('begin').addEventListener('click', begin);
$('resume').addEventListener('click', () => setPause(false));
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
    event.preventDefault();
    if (started) notify('Unsaved walking pilot. Closing this session discards its progress.');
    return;
  }
  if (!started) return;
  if (event.code === 'Escape') {
    event.preventDefault();
    if (!event.repeat) setPause(!paused);
    return;
  }
  if (paused || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (movementCodes.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
function clearInput() { keys.clear(); anim.moving = false; }
window.addEventListener('blur', () => { windowFocused = false; clearInput(); });
window.addEventListener('focus', () => { windowFocused = true; clearInput(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
window.aincradAgent?.onWindowActive?.(active => {
  windowFocused = active;
  clearInput();
});
window.addEventListener('resize', () => renderer.resize());

// Present only on the exact pilot test route for isolated native verification.
window.__ozarkPilot = Object.freeze({
  snapshot: () => ({
    player: { ...state.player }, observation: geometry.observe(state.player),
    profileIdentity: geometry.profile.identity, started, paused,
  }),
  start: begin,
});
