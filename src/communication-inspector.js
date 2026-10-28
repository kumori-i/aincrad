// Read-only view of the main world's learners. No population, clock or save ownership.
import { OzarkWorldRenderer } from './ozark-world-renderer.js';
import { paintCommunicationPixels } from './communication-experiment-ui.js';

const count = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const safeText = value => typeof value === 'string' ? value.slice(0, 160) : '';
const gauge = value => Number.isFinite(value) ? `${value.toFixed(1)}/100` : '—';

export function installCommunicationInspector({
  document, window, state, geometry, getLearning, getError = () => '',
  canOpen = () => true, onEnter = () => {}, onExit = () => {},
  setPaused, isPaused,
  createRenderer = (canvas, world) => new OzarkWorldRenderer(canvas, world),
  now = () => performance.now(),
}) {
  const $ = id => document.getElementById(id);
  const dialog = $('communication-dialog'), listeners = [];
  let active = false, disposed = false, frame = null, renderer = null, snapshot = null, lastRefresh = -Infinity;
  const text = (id, value) => { $(id).textContent = value; };
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener?.(event, handler, options));
  };
  function renderSnapshot(value) {
    snapshot = value;
    const paused = isPaused();
    text('communication-status', `${paused ? 'World paused' : 'World running'} · These are the same Aster and Mira who live in your main world.`);
    text('communication-pause', paused ? 'Resume world' : 'Pause world');
    text('communication-elapsed', `${count(value.elapsed)} simulation seconds · main world clock`);
    text('communication-counts', `${count(value.exchanges)} messages / action selections · ${count(value.updates)} updates · ${count(value.positive)} positive · ${count(value.negative)} negative · ${count(value.relief)} relief · ${count(value.discomfort)} discomfort · ${count(value.effortExpiry)} effort-only expiries · ${count(value.censored)} censored · ${count(value.pending)} pending`);
    const agents = Array.isArray(value.agents) ? value.agents.slice(0, 2) : [];
    text('communication-bodies', agents.map(agent => `${safeText(agent.name || agent.id)}: food ${gauge(agent.hunger)}, water ${gauge(agent.thirst)}, energy ${gauge(agent.energy)}. Meals ${count(agent.meals)}, drinks ${count(agent.drinks)}, collapses ${count(agent.collapses)}. New samples ${count(agent.samples)}, conventional social events ${count(agent.conventionalSocialEvents)}.`).join('\n'));
    const g = value.gates || {};
    text('communication-gates', `Optional choices ${count(g.optional)} → eligible ${count(g.eligible)}. Blocked: receiver busy ${count(g.receiverBusy)}, cooldown ${count(g.cooldown)}, no nearby available peer ${count(g.noPeer)}, no source experience ${count(g.noSource)}, sender busy ${count(g.senderBusy)}, stale source ${count(g.staleSource)}, insufficient current crops ${count(g.insufficientCrops)}. Captures ${count(g.captures)}, crops ${count(g.crops)}, new samples without matching earlier crop ${count(g.samplesWithoutCrop)}, source records ${count(g.sources)}. These counts describe gates reached, not learned meanings.`);
    const latest = value.latest;
    if (!latest) {
      text('communication-message', 'No exchange yet. Agents need their own new experience and a nearby opportunity.');
      text('communication-outcome', 'No communication benefit has been established.');
      paintCommunicationPixels($('communication-sender-pixels'), null);
      paintCommunicationPixels($('communication-receiver-pixels'), null);
      return;
    }
    const tokens = Array.isArray(latest.tokens) && latest.tokens.length === 2 && latest.tokens.every(token => Number.isInteger(token) && token >= 0 && token < 8) ? latest.tokens.join(' · ') : '—';
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
  function clearSnapshot() {
    snapshot = null;
    for (const id of ['communication-elapsed', 'communication-counts', 'communication-bodies', 'communication-gates', 'communication-message', 'communication-outcome']) text(id, 'Unavailable — no current learner data.');
    paintCommunicationPixels($('communication-sender-pixels'), null);
    paintCommunicationPixels($('communication-receiver-pixels'), null);
  }
  function refresh() {
    if (!active || disposed) return;
    try {
      lastRefresh = now();
      if (renderer) renderer.draw({ ...state, selectedAgentId: $('communication-follow').value });
      const learning = getLearning();
      if (!learning) {
        clearSnapshot();
        text('communication-pause', isPaused() ? 'Resume world' : 'Pause world');
        text('communication-status', `Communication learning unavailable. ${safeText(getError()) || 'The survival world remains separate from this diagnostic failure.'}`);
        return;
      }
      renderSnapshot(learning.snapshot());
    } catch {
      clearSnapshot();
      text('communication-status', 'The learning inspector could not refresh. Close this view to return to the world.');
    }
  }
  function paint() {
    frame = null;
    if (!active || disposed) return;
    // Fingerprints and gate text are diagnostic reads, bounded to four per second.
    if (now() - lastRefresh >= 250) refresh();
    else if (renderer) {
      try { renderer.draw({ ...state, selectedAgentId: $('communication-follow').value }); }
      catch { clearSnapshot(); text('communication-status', 'The learning inspector could not refresh. Close this view to return to the world.'); }
    }
    frame = window.requestAnimationFrame(paint);
  }
  function open() {
    if (active || disposed || !canOpen()) return false;
    try {
      onEnter(); dialog.showModal(); active = true;
      renderer = createRenderer($('communication-world'), geometry);
      renderer.followNpc = true; renderer.followId = $('communication-follow').value;
      resize(); refresh(); frame = window.requestAnimationFrame(paint);
      $('communication-close').focus(); return true;
    } catch {
      active = false; renderer = null; dialog.close(); onExit(); return false;
    }
  }
  function close() {
    if (!active) return;
    active = false;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null; renderer = null; dialog.close(); onExit(); $('open-communication').focus();
  }
  function togglePause() { setPaused(!isPaused()); refresh(); }
  listen($('open-communication'), 'click', open);
  listen($('communication-close'), 'click', close);
  listen($('communication-pause'), 'click', togglePause);
  listen($('communication-follow'), 'change', () => {
    if (renderer && ['aster', 'mira'].includes($('communication-follow').value)) renderer.followId = $('communication-follow').value;
    refresh();
  });
  listen(dialog, 'cancel', event => event.preventDefault());
  listen(window, 'resize', resize);
  listen(window, 'keydown', event => {
    if (!active) return;
    // Saving belongs to the main world, even with its inspector open.
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') return;
    event.stopImmediatePropagation();
    if (event.code === 'Escape' || event.key === 'Escape') {
      event.preventDefault(); if (!event.repeat) togglePause();
    }
  }, true);
  return Object.freeze({ open, close, refresh, active: () => active,
    status: () => ({ active, paused: isPaused(), snapshot }),
    dispose() { if (disposed) return; close(); disposed = true; for (const remove of listeners) remove(); },
  });
}
