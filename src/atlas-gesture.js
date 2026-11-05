// Atlas input only. Coordinates and pan deltas use canvas pixels, as the
// viewport does; no world, renderer or persistence state belongs here.
export function atlasEventPoint(atlas, event) {
  const rect = atlas.getBoundingClientRect();
  if (![event.clientX, event.clientY, rect.left, rect.top, rect.width, rect.height,
    atlas.width, atlas.height].every(Number.isFinite) ||
    rect.width <= 0 || rect.height <= 0 || atlas.width <= 0 || atlas.height <= 0) return null;
  const x = (event.clientX - rect.left) / rect.width * atlas.width;
  const y = (event.clientY - rect.top) / rect.height * atlas.height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function installAtlasGesture({ atlas, enabled, onPan, onClick }) {
  let gesture = null;
  let disposed = false;
  const available = () => !disposed && enabled();
  const inside = point => point && point.x >= 0 && point.y >= 0 &&
    point.x <= atlas.width && point.y <= atlas.height;
  const owns = event => gesture && gesture.id === event.pointerId;
  function captured(id) {
    try { return atlas.hasPointerCapture(id); } catch { return false; }
  }
  function cancel() {
    const previous = gesture;
    // Retire ownership before release can dispatch lostpointercapture.
    gesture = null;
    if (previous) try {
      if (atlas.hasPointerCapture(previous.id)) atlas.releasePointerCapture(previous.id);
    } catch { /* A detached element or already-ended pointer still stays canceled. */ }
  }
  function pointerdown(event) {
    if (gesture || !available() || event.isPrimary !== true || event.button !== 0 ||
        event.buttons !== 1 || !Number.isInteger(event.pointerId) || event.pointerId < 0) return;
    const at = atlasEventPoint(atlas, event);
    if (!inside(at)) return;
    gesture = { id: event.pointerId, origin: at, last: at, moved: false };
    try {
      atlas.setPointerCapture(event.pointerId);
      if (!captured(event.pointerId)) cancel();
    } catch { cancel(); }
  }
  function pointermove(event) {
    if (!owns(event)) return;
    if (!available() || !captured(event.pointerId) || event.isPrimary !== true || event.buttons !== 1) {
      cancel(); return;
    }
    const at = atlasEventPoint(atlas, event);
    if (!at) { cancel(); return; }
    const dx = at.x - gesture.last.x, dy = at.y - gesture.last.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) { cancel(); return; }
    // Small individual moves can add up to a drag. Once crossed, returning to
    // the origin must not turn that drag back into a waypoint-producing click.
    gesture.moved ||= Math.hypot(at.x - gesture.origin.x, at.y - gesture.origin.y) > 2;
    gesture.last = at;
    if (gesture.moved && (dx || dy)) onPan(dx, dy);
  }
  function pointerup(event) {
    if (!owns(event)) return;
    if (!available() || !captured(event.pointerId) || event.isPrimary !== true ||
        event.button !== 0 || event.buttons !== 0) {
      cancel(); return;
    }
    const at = atlasEventPoint(atlas, event);
    // Include release displacement even if the browser omitted a final move.
    const click = inside(at) && !gesture.moved &&
      Math.hypot(at.x - gesture.origin.x, at.y - gesture.origin.y) <= 2;
    cancel();
    if (click && available()) onClick(at);
  }
  function interrupted(event) { if (owns(event)) cancel(); }
  const handlers = { pointerdown, pointermove, pointerup,
    pointercancel: interrupted, lostpointercapture: interrupted };
  for (const [type, handler] of Object.entries(handlers)) atlas.addEventListener(type, handler);
  return {
    cancel,
    dispose() {
      disposed = true; cancel();
      for (const [type, handler] of Object.entries(handlers)) atlas.removeEventListener(type, handler);
    },
  };
}
