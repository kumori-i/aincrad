// A session-only, first-person receipt for an attempted pilot movement. The
// geometry remains authoritative; private depth and flow values stay out of
// the receipt.
import { CONFIG } from './config.js';

const clamp = value => Math.max(0, Math.min(1, value));
const change = (before, after, up, down) =>
  after > before + 1e-9 ? up : after < before - 1e-9 ? down : 'steady';

export function applyPilotMovement(geometry, state, { dx, dy, dt, sprint = false }) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) ||
      !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(state?.wetness) ||
      !Number.isFinite(state?.effort) || !Number.isFinite(state?.elapsed)) {
    throw new TypeError('Pilot movement needs finite input and body state');
  }
  const durationSeconds = Math.min(dt, .25);
  const startedAt = state.elapsed;
  const startPosition = Object.freeze({ x: state.player.x, y: state.player.y });
  const inputLength = Math.hypot(dx, dy);
  const beforeObservation = inputLength ? geometry.observe(state.player) : null;
  const wetnessBefore = state.wetness, effortBefore = state.effort;
  const motion = geometry.advance(state.player, dx, dy, dt, sprint);
  const waterSeconds = Math.max(0, Math.min(durationSeconds, motion.waterSeconds));
  const drySeconds = durationSeconds - waterSeconds;
  state.wetness = clamp(state.wetness + waterSeconds * .18 - drySeconds * .02);
  state.effort = clamp(state.effort +
    waterSeconds * (.09 + .06 * (motion.depthProxy ?? 0)) -
    drySeconds * (inputLength ? .01 : .035));
  state.elapsed += durationSeconds;
  if (!inputLength) return Object.freeze({ distance: motion.distance, evidence: null });

  const position = Object.freeze({ x: state.player.x, y: state.player.y });
  const dryExpected = CONFIG.walkSpeed *
    (sprint ? CONFIG.sprintMultiplier : 1) * durationSeconds;
  // This is perceived forward displacement relative to the actor's attempted
  // gait. It does not reveal which part of the motion came from the current,
  // nor assert what terrain caused little progress.
  const forward = ((position.x - startPosition.x) * dx +
    (position.y - startPosition.y) * dy) / inputLength;
  const code = forward <= dryExpected * .15 ? 'NEGLIGIBLE_PROGRESS' :
    forward < dryExpected * .95 ? 'PARTIAL' : 'MOVED';
  const resistance = code === 'NEGLIGIBLE_PROGRESS' ? 'strong' :
    code === 'PARTIAL' ? 'resisted' : 'free';
  const evidence = Object.freeze({
    startedAt, at: state.elapsed,
    action: Object.freeze({
      type: 'move',
      direction: Object.freeze({ x: dx / inputLength, y: dy / inputLength }),
      durationSeconds, sprint: Boolean(sprint),
    }),
    result: Object.freeze({
      ok: code !== 'NEGLIGIBLE_PROGRESS', code,
      displacement: Object.freeze({
        x: position.x - startPosition.x, y: position.y - startPosition.y,
      }),
      resistance,
      effort: change(effortBefore, state.effort, 'rising', 'easing'),
      wetness: change(wetnessBefore, state.wetness, 'wetter', 'drying'),
    }),
    startPosition, position, beforeObservation,
    afterObservation: geometry.observe(state.player),
  });
  return Object.freeze({ distance: motion.distance, evidence });
}
