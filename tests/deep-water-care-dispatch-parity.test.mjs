import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryDecision } from '../src/discovery.js';
import { createNpc } from '../src/npc-state.js';
import { baselineDecision, terrainDecision } from './fixtures/deep-water-policy-reference.mjs';
import { makeCareFixture, cloneCareFixture, keepObservedSource, POSITIONS } from './fixtures/deep-water-care-dispatch.mjs';

function parity(f, { options, configure = () => {} } = {}) {
  const control = cloneCareFixture(f);
  configure(f); configure(control);
  f.setDecisionGuard(true); control.setDecisionGuard(true);
  const expected = baselineDecision(control.actor, options);
  const actual = discoveryDecision(f.actor, options);
  assert.deepEqual(actual, expected, 'same complete decision');
  assert.deepEqual(f.state, control.state, 'same complete actor/world, including RNG');
  return actual;
}
function forgetBanks(f) {
  f.actor.memory.cells = Object.fromEntries(Object.entries(f.actor.memory.cells)
    .filter(([, cell]) => !['dry-ground', 'visible-divide'].includes(cell.terrain)));
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

test('dry and soaked-dry remembered-water approaches retain exact world and RNG parity', () => {
  for (const wetness of [0, 100]) {
    const f = makeCareFixture({ position: { x: -1120, y: 400 } });
    f.actor.thermal.wetness = wetness;
    assert.equal(f.geometry.observe(f.actor.position).ground, 'dry-land');
    assert.equal(terrainDecision(f.actor), null);
    const choice = parity(f);
    assert.equal(choice.action.type, 'move'); assert.equal(choice.need, 'water');
  }
});

test('shallow-water and dry curiosity are not promoted over an out-of-reach source approach', () => {
  for (const [position, sourceId, ground] of [
    [POSITIONS.shallow, 'ozark-water:-16:5', 'shallow-water'],
    [POSITIONS.dry, 'ozark-water:-14:-5', 'dry-land'],
  ]) {
    const f = makeCareFixture({ position, sourceId });
    assert.equal(f.geometry.observe(f.actor.position).ground, ground);
    assert.equal(terrainDecision(f.actor).need, 'understanding');
    const choice = parity(f);
    assert.equal(choice.action.type, 'move'); assert.equal(choice.need, 'water');
  }
});

test('deep water without retained banks keeps the ordinary approach, not curiosity', () => {
  const f = makeCareFixture(); forgetBanks(f);
  assert.equal(terrainDecision(f.actor).need, 'understanding');
  const choice = parity(f);
  assert.equal(choice.action.type, 'move'); assert.equal(choice.need, 'water');
});

test('recently attempted safety targets are not retried and null safety preserves the approach', () => {
  const f = makeCareFixture();
  // Adversarial bounded motor-history fixture, not evidence of newly earned motion.
  for (const cell of Object.values(f.actor.memory.cells)) {
    if (Math.hypot(cell.x - f.actor.position.x, cell.y - f.actor.position.y) > 160) continue;
    f.actor.memory.experience.push({ id: `attempt:${cell.key}`, at: f.actor.elapsed,
      type: 'action', details: { action: { type: 'swim', target: { x: cell.x, y: cell.y } },
        result: { ok: false, code: 'ROUTE_BLOCKED' } } });
  }
  assert.equal(terrainDecision(f.actor), null);
  const choice = parity(f);
  assert.equal(choice.action.type, 'move'); assert.equal(choice.need, 'water');
});

test('unavailable sources and absent remembered routes preserve the original later safety path', () => {
  for (const variant of ['unavailable', 'no-route']) {
    const f = makeCareFixture();
    if (variant === 'unavailable') {
      for (const source of Object.values(f.actor.memory.sources)) source.available = false;
    } else {
      for (const cell of Object.values(f.actor.memory.cells)) cell.walkable = false;
    }
    const before = f.calls.observe.length;
    const choice = parity(f);
    assert.equal(choice.need, 'safety');
    assert.equal(f.calls.observe.length - before, 1, 'only the existing later helper call');
  }
});

test('current LOS loss of remembered banks cannot authorize the safety override', () => {
  const f = makeCareFixture();
  const configure = row => row.setLineOfSightFilter((_from, to) => {
    const cell = Object.values(row.actor.memory.cells).find(c => c.x === to.x && c.y === to.y);
    return !cell || !['dry-ground', 'visible-divide'].includes(cell.terrain);
  });
  configure(f);
  assert.notEqual(terrainDecision(f.actor)?.need, 'safety');
  const choice = parity(f, { configure });
  assert.equal(choice.action.type, 'move'); assert.equal(choice.need, 'water');
});

test('terrain helper is read-only on a deeply frozen valley actor and complete world', () => {
  for (const position of [POSITIONS.deepRiver, { x: -1120, y: 400 }]) {
    const f = makeCareFixture({ position, guardDecision: true });
    const before = structuredClone(f.state), observed = f.calls.observe.length;
    freeze(f.state);
    const result = terrainDecision(f.actor);
    assert.equal(result?.need || null, position === POSITIONS.deepRiver ? 'safety' : null);
    assert.deepEqual(f.state, before);
    assert.equal(f.calls.observe.length - observed, 1);
  }
});

test('food-learning ablation and legacy/cave actors preserve complete decision and RNG parity', () => {
  const f = makeCareFixture({ position: { x: -1120, y: 400 } });
  parity(f, { options: { foodLearning: false } });
  for (const scene of ['valley', 'cave']) {
    const actor = createNpc({ mode: 'discovery', seed: 74193 }); actor.scene = scene;
    actor.physiology.waterDeficitMl = 1800;
    actor.memory.sources = { remembered: { id: 'remembered', x: 160, y: 160 } };
    const control = structuredClone(actor);
    assert.deepEqual(discoveryDecision(actor), baselineDecision(control));
    assert.deepEqual(actor, control);
  }
});

test('constructed observed-contact precedence remains ahead of the new deep-water hook', () => {
  const f = makeCareFixture();
  assert.equal(terrainDecision(f.actor).need, 'safety');
  // Policy precedence fixture only. Ozark ecology currently emits no human
  // contact attack; the separate native legacy test exercises actual injury.
  f.actor.memory.experience.push({ id: 'constructed-contact', at: f.actor.elapsed,
    type: 'condition', details: { code: 'CONTACT_INJURY',
      provenance: 'experienced contact', scene: 'valley', sourceId: 'test-contact',
      sourcePosition: { x: f.actor.position.x + 18, y: f.actor.position.y } } });
  f.actor.flask.water = .5;
  const count = f.calls.observe.length, choice = parity(f);
  assert.match(choice.reason, /contact I actually experienced/);
  assert.equal(choice.need, 'safety');
  assert.equal(choice.action.type, 'move');
  assert.equal(f.calls.observe.length, count, 'contact returns before the new helper');
});
