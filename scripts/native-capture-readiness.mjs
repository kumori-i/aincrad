/** Native QA only. Frame opportunities are readiness signals, not proof of
 * compositor contents. Keep the independent PNG-size guard and failed bytes. */
export async function waitForCaptureFrames() {
  await window.__aquaticQa?.settleDraw?.();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { readyState: document.readyState, visibilityState: document.visibilityState };
}

/** Serialized into native QA runners after frame readiness. This inspects only
 * the rendered DOM viewport; the retained PNG still needs visual inspection. */
export function conversationViewportEvidence(document, window, { eventId = null, message = null, actionText = null } = {}) {
  const find = id => {
    const node = document.getElementById(id);
    if (!node) throw new Error('Conversation capture is missing ' + id);
    return node;
  };
  const app = find('app'), panel = find('npc-panel'), tab = find('npc-tab-conversation'),
    section = find('journal-conversation'), journal = find('journal-messages');
  if (app.dataset.inspecting !== 'true' || panel.classList.contains('hidden') ||
      panel.dataset.journalTab !== 'conversation' || tab.getAttribute('aria-pressed') !== 'true' ||
      section.classList.contains('hidden')) throw new Error('Conversation capture is not on the active inspector tab');
  for (const id of ['world-loading', 'pause-panel', 'recovery-panel']) {
    const overlay = document.getElementById(id);
    if (overlay && window.getComputedStyle(overlay).display !== 'none')
      throw new Error('Conversation capture is covered by ' + id);
  }
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Conversation capture has no finite viewport');
  const rect = (node, label) => {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || !(Number(style.opacity) > 0))
        throw new Error('Conversation capture hides ' + label);
    }
    const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
    if (![left, right, top, bottom, width, height].every(Number.isFinite) ||
        width <= 0 || height <= 0 || left < 0 || top < 0 || right > viewport.width || bottom > viewport.height)
      throw new Error('Conversation capture places ' + label + ' outside the viewport');
    return { left, right, top, bottom, width, height };
  };
  const contains = (outer, inner) => inner.left >= outer.left && inner.right <= outer.right &&
    inner.top >= outer.top && inner.bottom <= outer.bottom;
  const hit = (node, bounds, label) => {
    const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
    if (!node.contains(document.elementFromPoint(x, y)))
      throw new Error('Conversation capture has an obscured ' + label);
  };
  const panelRect = rect(panel, 'inspector panel'), tabRect = rect(tab, 'Conversation tab'),
    sectionRect = rect(section, 'Conversation section'), journalRect = rect(journal, 'message journal');
  if (![tabRect, sectionRect, journalRect].every(bounds => contains(panelRect, bounds)))
    throw new Error('Conversation capture places its contents outside the inspector');
  hit(panel, panelRect, 'inspector panel'); hit(tab, tabRect, 'Conversation tab');
  hit(journal, journalRect, 'message journal');
  const result = { viewport, panel: panelRect, tab: tabRect, journal: journalRect };
  if (eventId !== null || message !== null || actionText !== null) {
    if (!Number.isSafeInteger(eventId) || eventId < 0 || !/^[a-z]{1,6}$/.test(message) ||
        typeof actionText !== 'string' || !actionText)
      throw new Error('Conversation capture has an invalid message witness');
    const entry = [...journal.querySelectorAll('article[data-learning-event]')]
      .find(node => node.dataset.learningEvent === String(eventId));
    const emitted = entry?.querySelector('[data-character-message="true"]');
    const action = [...(entry?.querySelectorAll('p') || [])]
      .find(node => node.textContent.includes(actionText));
    if (!emitted || emitted.textContent !== message || !action)
      throw new Error('Conversation capture lost the exact message or recipient action');
    const emittedRect = rect(emitted, 'sampled message'), actionRect = rect(action, 'recipient action');
    if (!contains(journalRect, emittedRect) || !contains(journalRect, actionRect))
      throw new Error('Conversation capture scrolled the message or action out of view');
    hit(emitted, emittedRect, 'sampled message'); hit(action, actionRect, 'recipient action');
    result.message = emittedRect; result.action = actionRect;
  }
  return result;
}

/** Self-contained for serialization into the isolated Electron main runner.
 * Retry only small/empty images, never fixture actions or assertion failures.
 * A stalled renderer/capture fails at the overall deadline; late results cannot
 * turn a timeout into success or overwrite retained evidence. */
export async function captureWithReadiness({ prepare, capture, retain,
  maxAttempts = 4, timeoutMs = 5000, now = () => performance.now() }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid native capture bounds');
  const started = now();
  const bounded = async operation => {
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) throw new Error('Native capture readiness timed out');
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native capture readiness timed out')), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const metadata = { attempt, maxAttempts, timeoutMs };
    let png;
    try {
      metadata.stage = 'readiness';
      metadata.readiness = await bounded(prepare);
      metadata.stage = 'capture';
      const image = await bounded(capture);
      png = image.toPNG();
      Object.assign(metadata, image.getSize(), { bytes: png.length, empty: image.isEmpty() });
      // Synchronous encoding also counts against the same deadline.
      if (now() - started >= timeoutMs) throw new Error('Native capture readiness timed out');
      metadata.status = !metadata.empty && png.length > 10000 ? 'ready' : 'small-or-empty';
    } catch (error) {
      metadata.status = 'error'; metadata.error = String(error?.stack || error);
      metadata.elapsedMs = now() - started;
      await retain(png, metadata);
      throw error;
    }
    metadata.elapsedMs = now() - started;
    await retain(png, metadata);
    if (metadata.status === 'ready') return { png, metadata };
  }
  throw new Error('Native capture remained small or empty after ' + maxAttempts + ' attempts');
}
