// Test-only hypothetical transducer. Exact aggregate health is not currently
// an actor-felt below-band signal; this file is never imported by production.
export const AGGREGATE_RESOLUTIONS = Object.freeze([.05, .25, 1]);
const HORIZON = 120;
const MAX_GAP = .25;
const MAX_SAMPLES = 7201;
const STREAK = 3;
const MIN_WORSENING_SECONDS = .25;
const EPSILON = 1e-8;

export function createAggregateSomaticProbe(owner, resolution) {
  if (!owner || !owner.physiology || !AGGREGATE_RESOLUTIONS.includes(resolution))
    throw new TypeError('A bound actor and predeclared resolution are required');
  const body = owner.physiology, id = owner.id, epoch = owner.epoch;
  let startTime = null, lastTime = null, startHealth = null;
  let samples = 0, streak = 0, firstWorseTime = null;
  let status = 'pending', censorReason = null;
  const read = () => Object.freeze({ status, censorReason, samples });
  const censor = reason => { status = 'censored'; censorReason = reason; return read(); };
  return Object.freeze({
    observe(actor) {
      if (status !== 'pending') return read();
      if (actor !== owner || actor.physiology !== body || actor.id !== id || actor.epoch !== epoch ||
          actor.lifecycle !== 'AWAKE') return censor('identity-or-lifecycle');
      const time = actor.elapsed, health = body.health;
      if (!Number.isFinite(time) || !Number.isFinite(health) || health < 0 || health > 100)
        return censor('invalid-observation');
      if (startTime === null) {
        startTime = time; lastTime = time; startHealth = health; samples = 1;
        return read();
      }
      const gap = time - lastTime;
      if (!(gap > 0) || time < startTime || time > startTime + HORIZON + EPSILON)
        return censor('clock-or-horizon');
      if (gap > MAX_GAP + EPSILON) return censor('missing-observation');
      if (samples >= MAX_SAMPLES) return censor('sample-cap');
      samples++; lastTime = time;
      if (startHealth - health >= resolution - EPSILON) {
        if (firstWorseTime === null) firstWorseTime = time;
        streak++;
      } else {
        firstWorseTime = null; streak = 0;
      }
      if (streak >= STREAK && time - firstWorseTime >= MIN_WORSENING_SECONDS - EPSILON)
        status = 'worsening';
      else if (time >= startTime + HORIZON - EPSILON) status = 'unresolved';
      return read();
    },
    read,
  });
}
