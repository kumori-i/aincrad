import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createOzarkWorldGeometry } from '../../src/ozark-world-geometry.js';
import { createOzarkState } from '../../src/ozark-save.js';
import { bindOzarkEcology } from '../../src/ozark-ecology.js';
import { bindOzarkWorldAgent } from '../../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../../src/npc.js';

// Fixed positions already exercised by the existing Ozark regression suite.
// These are controlled physical fixtures, not a saved-history reconstruction.
export const POSITIONS = Object.freeze({
  deepRiver: Object.freeze({ x: -1200, y: 220 }),
  shallow: Object.freeze({ x: -1200, y: 240 }),
  riverExit: Object.freeze({ x: -920, y: -500 }),
  dry: Object.freeze({ x: -960, y: -560 }),
  deepPond: Object.freeze({ x: -11800, y: 11800 }),
});
const nativeGeometry = createOzarkWorldGeometry();

function bindFixture(state, actorId, observation) {
  const actor = state.agents.find(row => row.id === actorId);
  let guardDecision = false;
  let lineOfSightFilter = null;
  const calls = { observe: [], lineOfSight: 0, sample: 0, classify: 0 };
  const metrics = { distance: 0, driftDistance: 0, effortSeconds: 0,
    waterSeconds: 0, swimSeconds: 0, intentionalDistance: 0, advances: 0 };
  const geometry = Object.freeze({ ...nativeGeometry,
    sample(...args) {
      calls.sample++;
      assert.equal(guardDecision, false, 'policy must not sample private terrain');
      return nativeGeometry.sample(...args);
    },
    classify(...args) {
      calls.classify++;
      assert.equal(guardDecision, false, 'policy must not classify private terrain');
      return nativeGeometry.classify(...args);
    },
    observe(point) {
      calls.observe.push({ ...point });
      if (guardDecision) assert.deepEqual(point, actor.position,
        'policy may sense current footing, not remote ground');
      return nativeGeometry.observe(point);
    },
    lineOfSight(...args) {
      calls.lineOfSight++;
      return nativeGeometry.lineOfSight(...args) &&
        (!lineOfSightFilter || lineOfSightFilter(...args));
    },
    advance(...args) {
      assert.equal(guardDecision, false, 'selection cannot execute physical motion');
      const result = nativeGeometry.advance(...args);
      metrics.advances++;
      for (const key of ['distance', 'driftDistance', 'effortSeconds',
        'waterSeconds', 'swimSeconds']) metrics[key] += result[key] || 0;
      metrics.intentionalDistance += Math.max(0,
        (result.distance || 0) - (result.driftDistance || 0));
      return result;
    },
  });
  bindOzarkEcology(state.environment.ecology, geometry);
  bindOzarkWorldAgent(actor, geometry, state);
  return { actor, state, environment: state.environment, geometry, observation,
    metrics, calls, setDecisionGuard(value = true) { guardDecision = value; },
    setLineOfSightFilter(filter = null) { lineOfSightFilter = filter; },
    getLineOfSightFilter() { return lineOfSightFilter; } };
}

export function makeCareFixture({ position = POSITIONS.deepRiver,
  deficitMl = 500, sourceId = null, guardDecision = false } = {}) {
  const state = createOzarkState(nativeGeometry), actor = state.agents[0];
  actor.position = { ...position };
  actor.physiology.waterDeficitMl = deficitMl;
  actor.flask.water = 0;
  const fixture = bindFixture(state, actor.id, null);
  refreshObservation(fixture);
  if (sourceId) keepObservedSource(fixture, sourceId);
  fixture.setDecisionGuard(guardDecision);
  return fixture;
}

export function cloneCareFixture(fixture) {
  const clone = bindFixture(structuredClone(fixture.state), fixture.actor.id,
    structuredClone(fixture.observation));
  clone.setLineOfSightFilter(fixture.getLineOfSightFilter());
  return clone;
}

export function refreshObservation(fixture) {
  fixture.observation = observeNpc(fixture.actor, fixture.environment);
  return fixture.observation;
}

// Forget other observed sources without introducing a location, availability
// claim, learned result, or route that the actor did not actually perceive.
export function keepObservedSource(fixture, id) {
  const source = fixture.actor.memory.sources[id];
  assert.ok(source, `source ${id} must already have been actually observed`);
  fixture.actor.memory.sources = { [id]: source };
  return source;
}

// One bounded native action, never an autonomous trajectory or seed search.
export function runNativeAction(fixture, action,
  { seconds = 2, untilComplete = false } = {}) {
  fixture.setDecisionGuard(false);
  const { actor, environment, metrics } = fixture;
  const before = { position: { ...actor.position }, elapsed: actor.elapsed,
    metabolizedKcal: actor.physiology.totals.metabolizedKcal,
    availableEnergyKcal: actor.physiology.availableEnergyKcal,
    stamina: actor.physiology.stamina, metrics: { ...metrics } };
  const admission = requestNpcAction(actor, action, environment);
  const ticks = Math.round(seconds / CONFIG.fixedStep);
  for (let i = 0; i < ticks; i++) {
    if (untilComplete && !actor.active) break;
    tickNpc(actor, CONFIG.fixedStep, environment);
  }
  const delta = Object.fromEntries(Object.keys(metrics).map(key =>
    [key, metrics[key] - before.metrics[key]]));
  return { admission, before, elapsed: actor.elapsed - before.elapsed,
    position: { ...actor.position }, active: structuredClone(actor.active),
    receipt: structuredClone(actor.lastResult), metrics: delta };
}
