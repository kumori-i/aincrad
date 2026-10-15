import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { tickEcology, lookupEcologyObject } from '../src/ecology.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { primitiveDuration, discoveryWorkFeedback } from '../src/discovery-actions.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { BIOLOGY_PROFILES, gameHours } from '../src/biology-config.js';
import { createPhysiology, projectPhysiology, exertPhysiology } from '../src/biology.js';
import { bodySignals } from '../src/interoception.js';
import { validateNpc } from '../src/npc-memory.js';
import { decisionObservation } from '../src/controller.js';
import { canStand } from '../src/world.js';

let fresh;
function fixture() {
  if (!fresh) {
    const n = createNpc({ mode: 'discovery', seed: 74193 });
    const e = createEnvironment(74193, { mode: 'discovery' });
    const plant = e.ecology.plants.find(p => p.kind === 'apple_tree' && p.quantity > 0);
    assert.ok(plant);
    // A controlled encounter with an existing source, not learned navigation.
    // Bodies, material composition, and the physical engine are unmodified.
    n.position = [
      { x: plant.position.x + 45, y: plant.position.y },
      { x: plant.position.x - 45, y: plant.position.y },
      { x: plant.position.x, y: plant.position.y + 45 },
    ].find(p => canStand(p.x, p.y, 'valley'));
    assert.ok(n.position);
    observeNpc(n, e);
    assert.ok(n.discovery.observations[plant.id]);
    fresh = { n, e, plant };
  }
  return structuredClone(fresh);
}
function tick(f, dt = .25) {
  tickEnvironment(f.e, dt);
  tickEcology(f.e.ecology, dt, f.e, [f.n]);
  tickNpc(f.n, dt, f.e);
}
function finish(f, action, dt = .25) {
  const started = requestNpcAction(f.n, action, f.e);
  assert.equal(started.code, 'ACTION_STARTED');
  const active = f.n.active;
  for (let i = 0; i < 1200 && f.n.active; i++) tick(f, dt);
  assert.equal(f.n.active, null, 'the authoritative action actually finished');
  return { result: f.n.lastResult, active };
}
function worked(f, type, seconds, dt = .25) {
  assert.equal(requestNpcAction(f.n, { type, targetId: f.plant.id }, f.e).code, 'ACTION_STARTED');
  const active = f.n.active;
  for (let remaining = seconds; remaining > 1e-10;) {
    const step = Math.min(dt, remaining);
    tick(f, step);
    remaining -= step;
  }
  assert.equal(f.n.active, active);
  assert.equal(cancelNpcAction(f.n), true);
  return { result: f.n.lastResult, active };
}
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} versus ${expected}`);
}
function recordedResult(n, result) {
  const event = n.memory.experience.find(e => e.id === result.eventId);
  assert.ok(event);
  return event.details.result;
}

test('real successful work reports actual duration and only qualitative action-local exertion', () => {
  const f = fixture(), before = structuredClone(f.n.physiology);
  const fatigue = bodySignals(f.n).fatigue;
  const { result, active } = finish(f, { type: 'inspect_object', targetId: f.plant.id });
  assert.equal(result.code, 'OBJECT_OBSERVED');
  assert.equal(result.ok, true);
  assert.equal(result.durationSeconds, 1.8);
  assert.ok(f.n.elapsed > result.durationSeconds, 'a final partial tick does not bill its unused time as action work');
  assert.equal(result.exertion, 'light');
  assert.equal(result.exertionContext, fatigue);
  near(active.performedExertion, .45, 'the meter accumulates actual motor calls');
  assert.equal(recordedResult(f.n, result).exertion, 'light');
  assert.ok(f.n.physiology.totals.metabolizedKcal > before.totals.metabolizedKcal);
  for (const key of ['performedExertion', 'energyKcal', 'waterMl', 'availableEnergyKcal', 'storedEnergyKcal']) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }
  const feedback = discoveryWorkFeedback(active), snapshot = structuredClone(f);
  assert.deepEqual(feedback, { durationSeconds: 1.8, exertionContext: fatigue, exertion: 'light' });
  assert.deepEqual(discoveryWorkFeedback(active), feedback);
  assert.deepEqual(f, snapshot, 'reading feedback is inert');
});

test('an actually completed unsuccessful grasp retains its paid work without granting successful practice', () => {
  const f = fixture(), quantity = f.plant.quantity;
  const { result, active } = finish(f, { type: 'grasp', targetId: f.plant.id });
  assert.equal(result.code, 'object_still_attached');
  assert.equal(result.ok, false);
  assert.equal(result.durationSeconds, 2.5);
  assert.equal(result.exertion, 'light');
  near(active.performedExertion, 1.25, 'failed work is still exertion');
  assert.equal(recordedResult(f.n, result).exertion, 'light');
  assert.equal(f.n.discovery.practice.grasp.successes, 0);
  assert.equal(f.n.discovery.practice.grasp.seconds, 0);
  assert.equal(f.n.discovery.practice.grasp.failures, 1);
  assert.equal(f.plant.quantity, quantity);
  assert.equal(f.n.inventory.items.length, 0);
  assert.equal(f.n.physiology.totals.ingestedKcal, 0);
});

test('immediate unknown and unheld-object refusals do not invent duration, effort or physical expenditure', () => {
  for (const type of ['pull', 'sample']) {
    const f = fixture(), before = structuredClone(f.n.physiology), time = f.n.elapsed;
    const result = requestNpcAction(f.n, { type, targetId: type === 'pull' ? 'object:999999999' : f.plant.id }, f.e);
    assert.equal(result.code, type === 'pull' ? 'UNKNOWN_OBJECT' : 'NOT_HELD');
    assert.equal(f.n.active, null);
    assert.equal(f.n.elapsed, time);
    assert.deepEqual(f.n.physiology, before);
    assert.equal(result.exertion, undefined);
    assert.equal(result.exertionContext, undefined);
    assert.equal(result.durationSeconds, undefined);
    assert.equal(recordedResult(f.n, result).exertion, undefined);
  }
});

test('cancel before the first physical step is zero work, regardless of scheduled operation cost', () => {
  const f = fixture(), before = structuredClone(f.n.physiology);
  assert.equal(requestNpcAction(f.n, { type: 'strike', targetId: f.plant.id }, f.e).code, 'ACTION_STARTED');
  assert.equal(cancelNpcAction(f.n), true);
  assert.equal(f.n.lastResult.durationSeconds, 0);
  assert.equal(f.n.lastResult.exertion, undefined);
  assert.equal(f.n.lastResult.exertionContext, undefined);
  assert.deepEqual(f.n.physiology, before);
  assert.equal(cancelNpcAction(f.n), false);
});

test('the same operation changes effort bands with actual partial work, rather than its name', () => {
  for (const [seconds, label] of [[.5, 'light'], [2, 'moderate']]) {
    const f = fixture(), quantity = f.plant.quantity;
    const { result, active } = worked(f, 'pull', seconds);
    assert.equal(result.code, 'PRIORITY_CHANGED');
    near(result.durationSeconds, seconds, 'only worked seconds are recorded');
    near(active.performedExertion, seconds * 1.5, 'only performed motor work is recorded');
    assert.equal(result.exertion, label);
    assert.equal(result.exertionContext, 'fresh');
    assert.equal(recordedResult(f.n, result).exertion, label);
    assert.equal(f.plant.quantity, quantity, 'cancellation cannot acquire the scheduled portion');
    assert.equal(f.n.inventory.items.length, 0);
    assert.equal(f.n.discovery.practice.pull.successes, 0);
  }
  const f = fixture(), { result } = finish(f, { type: 'pull', targetId: f.plant.id });
  assert.equal(result.ok, true);
  assert.equal(result.durationSeconds, 5);
  assert.equal(result.exertion, 'strenuous');
  assert.equal(f.n.inventory.items.length, 1);
});

test('equal actual motor work receives equal effort labels across differently named operations', () => {
  const a = worked(fixture(), 'pull', 2), b = worked(fixture(), 'strike', 3 / 2.2);
  near(a.active.performedExertion, 3, 'pull motor work');
  near(b.active.performedExertion, 3, 'strike motor work');
  assert.notEqual(a.result.durationSeconds, b.result.durationSeconds);
  assert.equal(a.result.exertion, 'moderate');
  assert.equal(a.result.exertion, b.result.exertion);
});

test('partial cancellation does not leak its prior effort into the next interaction', () => {
  const f = fixture();
  assert.equal(worked(f, 'strike', 3).result.exertion, 'strenuous');
  const { result, active } = finish(f, { type: 'inspect_object', targetId: f.plant.id });
  assert.equal(result.exertion, 'light');
  near(active.performedExertion, .45, 'new action starts with an empty work meter');
  assert.equal(result.durationSeconds, 1.8);
});

test('paid swallowing feedback preserves finite matter and delayed physiological effects', () => {
  const f = fixture();
  assert.equal(finish(f, { type: 'pull', targetId: f.plant.id }).result.ok, true);
  const id = f.n.inventory.items[0], material = lookupEcologyObject(f.e.ecology, id);
  const mass = material.massGrams, removed = f.e.ecology.ledger.humanRemovedKcal;
  const { result, active } = finish(f, { type: 'sample', targetId: id });
  assert.equal(result.code, 'SWALLOWED');
  assert.equal(result.exertion, 'light');
  assert.equal(result.delayed, true);
  assert.equal(result.durationSeconds, 3.5);
  near(active.performedExertion, 3.5 * .35, 'real swallowing effort');
  near(material.massGrams, mass - 30, 'finite swallowed mass');
  near(f.e.ecology.ledger.humanRemovedKcal - removed, f.n.physiology.totals.ingestedKcal, 'resource transfer equals ingestion');
  assert.ok(f.n.physiology.stomach.some(p => p.id === result.ingestionId));
  assert.equal(f.n.discovery.techniques.length, 0, 'an effort label is not nutritional evidence');
  assert.equal(f.n.physiology.outsideAssistance.count, 0);
});

test('actual successful practice lowers performed duration and work without changing the effort table', () => {
  const f = fixture(), before = primitiveDuration(f.n, 'pull');
  const first = finish(f, { type: 'pull', targetId: f.plant.id });
  finish(f, { type: 'release', targetId: f.n.inventory.items[0] });
  const second = finish(f, { type: 'pull', targetId: f.plant.id });
  assert.equal(first.result.durationSeconds, before);
  assert.ok(second.result.durationSeconds < first.result.durationSeconds);
  assert.ok(second.active.performedExertion < first.active.performedExertion);
  near(second.active.performedExertion, second.result.durationSeconds * DISCOVERY_RULES.effort.pull, 'practice is measured after execution');
});

test('work totals and felt bands do not depend on fixed-step subdivision', () => {
  const a = fixture(), b = fixture();
  const first = finish(a, { type: 'strike', targetId: a.plant.id }, .25);
  const second = finish(b, { type: 'strike', targetId: b.plant.id }, 1 / 60);
  near(first.result.durationSeconds, second.result.durationSeconds, 'duration is step-independent');
  near(first.active.performedExertion, second.active.performedExertion, 'motor work is step-independent');
  assert.equal(first.result.exertion, second.result.exertion);
  assert.equal(first.result.exertionContext, second.result.exertionContext);
});

test('work feedback has common threshold boundaries and no operation-name lookup', () => {
  for (const type of DISCOVERY_RULES.primitives) {
    for (const [performedExertion, expected] of [[.01, 'light'], [2, 'light'], [2.0001, 'moderate'], [6, 'moderate'], [6.0001, 'strenuous']]) {
      const active = { kind: 'interaction', request: { type }, seconds: 9, worked: 1, performedExertion, exertionContext: 'tired' };
      const before = structuredClone(active);
      assert.deepEqual(discoveryWorkFeedback(active), { durationSeconds: 1, exertionContext: 'tired', exertion: expected });
      assert.deepEqual(active, before);
    }
  }
});

test('missing legacy metadata never reconstructs an effort label from requested duration or operation', () => {
  for (const active of [undefined, null, {}, { kind: 'move', worked: 2, performedExertion: 20 }, { kind: 'interaction', seconds: 20 }]) {
    assert.deepEqual(discoveryWorkFeedback(active), {});
  }
  const feedback = discoveryWorkFeedback({ kind: 'interaction', request: { type: 'strike' }, seconds: 4, worked: 1.25 });
  assert.equal(feedback.durationSeconds, 1.25);
  assert.equal(feedback.exertion, undefined);
  assert.equal(feedback.exertionContext, undefined);
});

test('non-finite, negative, string and zero work cannot create qualitative effort evidence', () => {
  for (const worked of [undefined, NaN, Infinity, -Infinity, -1, 0, '2']) {
    assert.deepEqual(discoveryWorkFeedback({ kind: 'interaction', worked, performedExertion: 3, exertionContext: 'fresh' }), {});
  }
  for (const performedExertion of [undefined, NaN, Infinity, -Infinity, -1, 0, '3']) {
    const feedback = discoveryWorkFeedback({ kind: 'interaction', worked: 1, performedExertion, exertionContext: 'fresh' });
    assert.equal(feedback.durationSeconds, 1);
    assert.equal(feedback.exertion, undefined);
  }
});

test('saved actual work survives reopening while old saves without effort evidence remain unknown', () => {
  const f = fixture(), { result } = worked(f, 'strike', 2);
  const reopened = validateNpc(JSON.parse(JSON.stringify(f.n)));
  assert.equal(reopened.active, null);
  assert.equal(recordedResult(reopened, result).exertion, 'moderate');
  assert.equal(recordedResult(reopened, result).durationSeconds, 2);
  assert.equal(reopened.lastResult.exertion, 'moderate');
  const raw = JSON.parse(JSON.stringify(f.n));
  delete raw.lastResult.exertion;
  delete raw.lastResult.exertionContext;
  for (const event of raw.memory.experience) {
    if (!event.details.result) continue;
    delete event.details.result.exertion;
    delete event.details.result.exertionContext;
  }
  delete raw.discovery.selection;
  const legacy = validateNpc(raw);
  assert.equal(recordedResult(legacy, result).exertion, undefined);
  assert.equal(legacy.lastResult.exertion, undefined);
  assert.deepEqual(legacy.physiology, reopened.physiology);
  assert.equal(recordedResult(legacy, result).durationSeconds, 2);
});

test('ordinary decision observations never expose the private performed-work meter or physical rates', () => {
  const f = fixture();
  finish(f, { type: 'pull', targetId: f.plant.id });
  const encoded = JSON.stringify(decisionObservation(f.n));
  for (const key of ['performedExertion', 'walkingKcalPerHour', 'effortWaterMlPerHour', 'availableEnergyKcal', 'storedEnergyKcal', 'metabolizedKcal']) {
    assert.equal(encoded.includes(key), false, key);
  }
});

test('the physiology return value measures bounded work without adding another physical debit', () => {
  for (const profile of Object.keys(BIOLOGY_PROFILES)) {
    for (const effort of [.25, 1.5, 2.2, 8]) {
      const actor = projectPhysiology({ mode: 'discovery', lifecycle: 'AWAKE', physiology: createPhysiology(profile), thermal: { hot: 0, cold: 0, wetness: 0 } });
      const before = structuredClone(actor.physiology), seconds = 1.75, bounded = Math.min(effort, 5), p = BIOLOGY_PROFILES[profile];
      const motor = exertPhysiology(actor, seconds, effort), after = actor.physiology;
      assert.equal(motor, seconds * bounded);
      near(before.availableEnergyKcal - after.availableEnergyKcal, p.walkingKcalPerHour * bounded * gameHours(seconds), `${profile} one motor debit`);
      near(after.totals.metabolizedKcal - before.totals.metabolizedKcal, p.walkingKcalPerHour * bounded * gameHours(seconds), `${profile} metabolic ledger`);
      near(after.totals.waterLostMl - before.totals.waterLostMl, p.effortWaterMlPerHour * bounded * gameHours(seconds), `${profile} water ledger`);
      assert.equal(after.storedEnergyKcal, before.storedEnergyKcal);
      assert.equal(after.totals.ingestedKcal, 0);
      assert.equal(after.outsideAssistance.count, 0);
    }
  }
});

test('invalid motor requests neither change physiology nor return positive performed work', () => {
  for (const [seconds, effort] of [[0, 1], [-1, 1], [NaN, 1], [Infinity, 1], [1, 0], [1, -1], [1, NaN], [1, Infinity]]) {
    const n = fixture().n, before = structuredClone(n);
    const value = exertPhysiology(n, seconds, effort);
    assert.equal(value > 0, false);
    assert.deepEqual(n, before);
  }
});
