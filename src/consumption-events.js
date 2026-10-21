// Runtime-only synchronous transport. No queue, replay, saved bus or food data.
const listeners = new WeakMap(), failures = new WeakMap();
export function consumptionDeliveryDiagnostic(ecology) {
  const count=failures.get(ecology)||0;
  return count?{code:'OBSERVER_FAILED',failures:count}:null;
}
export function subscribeConsumption(ecology, listener) {
  let set = listeners.get(ecology);
  if (!set) listeners.set(ecology, set = new Set());
  set.add(listener);
  return () => { set.delete(listener); if (!set.size) listeners.delete(ecology); };
}
export function publishConsumption(ecology, actor, source) {
  if (!source || !actor?.position) return;
  const event = { actorId: actor.id, actorPosition: { ...actor.position },
    scene: actor.scene, source: structuredClone(source) };
  for (const listener of listeners.get(ecology) || []) {
    // Attention failure cannot undo swallowed finite matter or interrupt the
    // eater's pending personal receipt. Keep a bounded runtime diagnostic.
    try { listener(structuredClone(event)); }
    catch { failures.set(ecology,Math.min(1000000,(failures.get(ecology)||0)+1)); }
  }
}
