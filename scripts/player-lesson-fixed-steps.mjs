/** Harness-only duration adapter. Never pass a floating subtraction tail to the
 * ordinary test hook: every invocation must be one complete, fundable tick.
 * This is serialized into the native runner and has no runtime dependencies. */
export function advancePlayerLessonFixedSteps(step, fixedStep, seconds, dx = 0, dy = 0, mode = 'walk') {
  if (typeof step !== 'function' || !Number.isFinite(fixedStep) || fixedStep <= 0 ||
      !Number.isFinite(seconds) || seconds < 0 || seconds > 30 ||
      !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1 ||
      !['walk', 'climb', 'swim'].includes(mode)) return false;
  const ticks = Math.round(seconds / fixedStep);
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 10000 || seconds > 0 && ticks === 0)
    return false;
  const represented = ticks * fixedStep;
  // Only arithmetic-scale rounding is tolerated, never a meaningful partial tick.
  const tolerance = Math.min(fixedStep * 1e-9,
    Number.EPSILON * 8 * Math.max(1, seconds, represented));
  if (Math.abs(seconds - represented) > tolerance) return false;
  for (let tick = 0; tick < ticks; tick++) {
    if (step(fixedStep, dx, dy, mode) !== true) return false;
  }
  return true;
}
