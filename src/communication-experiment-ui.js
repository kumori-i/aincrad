// Owner-facing, disposable research session. It never receives storage or the
// saved world state. The ordinary world stays paused behind this modal.
import { CONFIG } from './config.js';
import { SimulationClock } from './simulation-clock.js';
import { OzarkWorldRenderer } from './ozark-world-renderer.js';

const MAX_SECONDS = 1800;
const count = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const safeText = value => typeof value === 'string' ? value.slice(0, 160) : '';
const gauge = value => Number.isFinite(value) ? `${value.toFixed(1)}/100` : safeText(value);

export function paintCommunicationPixels(canvas, pixels) {
  const context = canvas?.getContext?.('2d');
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!pixels || pixels.length !== 16 * 16 * 3 ||
      !Array.from(pixels).every(value => Number.isFinite(value) && value >= 0 && value <= 255)) return false;
  const image = context.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    image.data[i * 4] = pixels[i * 3];
    image.data[i * 4 + 1] = pixels[i * 3 + 1];
    image.data[i * 4 + 2] = pixels[i * 3 + 2];
    image.data[i * 4 + 3] = 255;
  }
  canvas.width = canvas.height = 16;
  context.putImageData(image, 0, 0);
  return true;
}

export function installCommunicationExperiment({
  document, window, geometry, canOpen = () => true, onEnter = () => {}, onExit = () => {},
  createExperiment, createPixelSensor,
  createRenderer = (canvas, world) => new OzarkWorldRenderer(canvas, world),
  now = () => performance.now() / 1000,
}) {
  const $ = id => document.getElementById(id);
  const dialog = $('communication-dialog');
  let active = false, busy = false, paused = true, disposed = false, generation = 0;
  let experiment = null, sensor = null, renderer = null, timer = null, frame = null;
  let snapshot = null, lastPaint = -Infinity, speed = 1;
  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener?.(type, handler, options));
  };
  const text = (id, value) => { $(id).textContent = value; };
  const clock = new SimulationClock({ step: CONFIG.fixedStep, maxSteps: 120,
    onStep: dt => {
      if (experiment && !paused) experiment.tick(dt);
    } });

  function controls() {
    $('communication-start').disabled = busy;
    $('communication-stop').disabled = !experiment && !busy;
    $('communication-seed').disabled = busy;
    $('communication-enabled').disabled = busy;
    $('communication-speed').disabled = !experiment || busy;
    $('communication-follow').disabled = !experiment || busy;
  }
  // Cleanup must finish even if a partially constructed runtime fails retirement.
  const retire = value => { try { value?.dispose?.(); } catch { /* already detached */ } };
  function releaseSession() {
    if (timer !== null) window.clearInterval(timer);
    if (frame !== null) window.cancelAnimationFrame(frame);
    timer = frame = null;
    const old = experiment, oldSensor = sensor;
    experiment = sensor = renderer = null;
    retire(old); retire(oldSensor);
  }
  function stop(message = 'Stopped. This experiment is not saved. Start fresh to try again.') {
    generation++; busy = false; paused = true;
    releaseSession(); clock.reset(now()); controls();
    text('communication-status', message);
  }
  function renderSnapshot(value) {
    if (!value || typeof value !== 'object') return;
    snapshot = value;
    text('communication-elapsed', `${count(value.elapsed)} / ${MAX_SECONDS} simulation seconds`);
    text('communication-counts', `${count(value.exchanges)} exchanges · ${count(value.updates)} learning updates · ${count(value.positive)} positive · ${count(value.negative)} negative · ${count(value.attributed)} attributed · ${count(value.expired)} expired · ${count(value.censored)} censored`);
    const agents = Array.isArray(value.agents) ? value.agents.slice(0, 2) : [];
    text('communication-bodies', agents.map(agent =>
      `${safeText(agent.name || agent.id)}: food ${gauge(agent.hunger)}, water ${gauge(agent.thirst)}, energy ${gauge(agent.energy)}. Meals ${count(agent.meals)}, drinks ${count(agent.drinks)}, collapses ${count(agent.collapses)}. Samples ${count(agent.samples)}, conventional social events ${count(agent.conventionalSocialEvents)}.`).join('\n'));
    const latest = value.latest;
    if (!latest) {
      text('communication-message', 'No exchange yet. Agents need their own experience and a nearby opportunity.');
      text('communication-outcome', 'No communication benefit has been established.');
      paintCommunicationPixels($('communication-sender-pixels'), null);
      paintCommunicationPixels($('communication-receiver-pixels'), null);
      return;
    }
    const tokens = Array.isArray(latest.tokens) && latest.tokens.length === 2 &&
      latest.tokens.every(token => Number.isInteger(token) && token >= 0 && token < 8) ? latest.tokens.join(' · ') : '—';
    text('communication-message', `${safeText(latest.senderId)} → ${safeText(latest.receiverId)}: ${tokens}`);
    const action = typeof latest.action === 'string' ? latest.action : latest.action?.type;
    text('communication-outcome', `${safeText(latest.status) || 'Pending'}${action ? ` · action ${safeText(action)}` : ''}${Number.isFinite(latest.reward) ? ` · measured reward ${latest.reward.toFixed(3)}` : ''}`);
    paintCommunicationPixels($('communication-sender-pixels'), latest.senderPixels);
    paintCommunicationPixels($('communication-receiver-pixels'), latest.receiverPixels);
  }
  function resize() {
    if (!renderer) return;
    const box = $('communication-world').getBoundingClientRect();
    renderer.resize(Math.max(240, box.width), Math.max(180, box.height), window.devicePixelRatio || 1);
  }
  function paint() {
    frame = null;
    if (!active || !experiment || !renderer || disposed) return;
    try {
      // Viewer selection is presentation only, never a neural policy input.
      const state = experiment.state;
      renderer.draw({ ...state, selectedAgentId: $('communication-follow').value });
      const time = now();
      if (time - lastPaint >= .25) { renderSnapshot(experiment.snapshot()); lastPaint = time; }
      frame = window.requestAnimationFrame(paint);
    } catch {
      stop('The experimental view stopped after an error. Your ordinary world remains unchanged.');
    }
  }
  function advance() {
    if (!active || !experiment || disposed) return;
    try {
      clock.advance(now(), { running: !paused, speed });
      const value = experiment.snapshot();
      if (value.elapsed >= MAX_SECONDS || value.stopped === true) {
        paused = true; clock.reset(now());
        text('communication-status', 'Session limit reached. Results remain visible; Start fresh begins new learners.');
      }
    } catch {
      stop('The experiment stopped after an error. Your ordinary world remains unchanged.');
    }
  }
  async function start() {
    if (!active || busy || disposed) return false;
    const raw = $('communication-seed').value.trim();
    const seed = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(seed) || seed < 1 || seed > 4294967295) {
      text('communication-status', 'Choose a whole-number seed from 1 to 4294967295.');
      $('communication-seed').focus(); return false;
    }
    const enabled = $('communication-enabled').checked === true;
    stop('Preparing fresh agents and an unsaved environment…');
    const ticket = generation;
    busy = true; snapshot = null; controls(); renderSnapshot({ elapsed: 0 });
    let createdSensor = null, created = null;
    try {
      const experimentFactory = createExperiment || (await import('./communication-experiment.js')).createCommunicationExperiment;
      const sensorFactory = createPixelSensor || (await import('./communication-pixels.js')).createCommunicationPixelSensor;
      if (!active || disposed || ticket !== generation) return false;
      createdSensor = await sensorFactory(document);
      if (!active || disposed || ticket !== generation) { retire(createdSensor); return false; }
      created = await experimentFactory({ geometry, seed, enabled, pixelSensor: createdSensor });
      if (!active || disposed || ticket !== generation) { retire(created); retire(createdSensor); return false; }
      if (!created?.state || typeof created.tick !== 'function' || typeof created.snapshot !== 'function' || typeof created.dispose !== 'function') throw new TypeError('Invalid experiment');
      experiment = created; sensor = createdSensor;
      renderer = createRenderer($('communication-world'), geometry);
      renderer.followNpc = true; renderer.followId = $('communication-follow').value;
      resize(); paused = false; busy = false; speed = Number($('communication-speed').value);
      if (![1, 4, 16].includes(speed)) speed = 1;
      lastPaint = -Infinity; clock.reset(now()); controls();
      text('communication-status', `Running · seed ${seed} · ${enabled ? 'learned symbols enabled' : 'constant-message control'}. Escape pauses this experiment.`);
      renderSnapshot(experiment.snapshot());
      timer = window.setInterval(advance, 1000 / 30);
      frame = window.requestAnimationFrame(paint);
      return true;
    } catch {
      if (ticket !== generation || !active || disposed) {
        retire(created); retire(createdSensor); return false;
      }
      if (experiment !== created) retire(created);
      if (sensor !== createdSensor) retire(createdSensor);
      stop('The experiment could not start. Your ordinary world remains unchanged.');
      return false;
    }
  }
  function open(event) {
    if (active || disposed || !canOpen()) return false;
    active = true; paused = true; snapshot = null;
    try { onEnter(); dialog.showModal(); } catch { active = false; return false; }
    controls();
    text('communication-status', 'Ready. Start fresh creates new learners; no saved memories or pretrained vocabulary are loaded.');
    renderSnapshot({ elapsed: 0 }); $('communication-start').focus();
    return true;
  }
  function close() {
    if (!active) return;
    stop(); active = false; dialog.close(); onExit(); $('open-communication').focus();
  }
  function togglePause() {
    if (!active || !experiment || busy || count(experiment.snapshot()?.elapsed) >= MAX_SECONDS) return;
    paused = !paused; clock.reset(now());
    text('communication-status', paused ? 'Experiment paused. Escape resumes; the ordinary world is also paused.' : 'Experiment running. Escape pauses this experiment.');
  }
  function keydown(event) {
    if (!active) return;
    // Modal keystrokes must not reach ordinary-world journal, save or movement handlers.
    event.stopImmediatePropagation();
    if (event.code === 'Escape' || event.key === 'Escape') {
      event.preventDefault(); if (!event.repeat) togglePause();
    } else if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
      event.preventDefault(); text('communication-status', 'This disposable experiment is not saved. Your ordinary save remains unchanged.');
    }
  }
  listen($('open-communication'), 'click', open);
  listen($('communication-start'), 'click', start);
  listen($('communication-stop'), 'click', () => stop());
  listen($('communication-close'), 'click', close);
  listen($('communication-speed'), 'change', () => {
    const next = Number($('communication-speed').value);
    if ([1, 4, 16].includes(next)) { speed = next; clock.reset(now()); }
  });
  listen($('communication-follow'), 'change', () => {
    if (renderer && ['aster', 'mira'].includes($('communication-follow').value)) renderer.followId = $('communication-follow').value;
  });
  listen(dialog, 'cancel', event => event.preventDefault());
  listen(window, 'keydown', keydown, true);
  listen(window, 'resize', resize);
  // Retire the unsaved session before leaving. Keep active true so ordinary
  // unload-save handlers cannot mistake this experiment for a resumed world.
  listen(window, 'pagehide', () => { if (active) stop(); });
  controls();
  return Object.freeze({ open, close, start, stop, active: () => active,
    status: () => ({ active, busy, paused, running: !!experiment && !paused, snapshot }),
    dispose() { if (disposed) return; close(); disposed = true; for (const remove of listeners) remove(); },
  });
}
