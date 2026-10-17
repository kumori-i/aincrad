import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';
import { applyPilotMovement } from '../src/ozark-pilot-action-evidence.js';
import { createOzarkWadingAgentSession } from '../src/ozark-agent-session.js';
import { requestNpcAction, rescueNpc } from '../src/npc.js';
import { freshState } from '../src/world.js';

// Acceptance for the first agent slice only. These executable checks establish
// autonomous selection, physical contact and first-person evidence. A later
// experiment must compare learning against an ablated baseline. Save/load is
// deliberately unsupported while this is a fresh, isolated pilot geometry.
const BANK = Object.freeze({ x: -1200, y: 400 });
const SHALLOW = Object.freeze({ x: -1200, y: 240 });
const DEEP = Object.freeze({ x: -1200, y: 200 });
const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);

function actionEvents(npc) {
  return npc.memory.experience.filter(event => event.type === 'action');
}

test('fresh Aster autonomously chooses an observed shallow frontier and experiences the completed move', () => {
  assert.equal(geometry.classify(BANK.x, BANK.y).reason, 'dry-ground');
  assert.equal(geometry.classify(SHALLOW.x, SHALLOW.y).reason, 'shallow-water');
  const session = createOzarkWadingAgentSession(geometry, { position: BANK, seed: CONFIG.seed });
  try {
    const { npc } = session;
    assert.equal(npc.id, 'aster');
    assert.equal(npc.mode, 'discovery');
    assert.equal(npc.learning, true);
    assert.deepEqual(npc.memory.skills, []);
    assert.deepEqual(actionEvents(npc), []);
    assert.deepEqual(npc.discovery.experiments, []);
    assert.deepEqual(npc.memory.values, {});
    assert.deepEqual(npc.position, BANK);
    const observedShallow = npc.memory.cells['-15,3'];
    assert.ok(observedShallow, 'the shoreline is locally observed at the bank');
    assert.equal(observedShallow.walkable, true);
    assert.equal(observedShallow.terrain, 'shallow-water');
    assert.ok(Math.hypot(observedShallow.x - BANK.x, observedShallow.y - BANK.y)
      <= NPC_RULES.visionRadius);
    for (const cell of Object.values(npc.memory.cells)) {
      assert.ok(Math.hypot(cell.x - BANK.x, cell.y - BANK.y)
        <= NPC_RULES.visionRadius, `cell ${cell.key} was not locally visible`);
    }
    const wetnessBefore = npc.thermal.wetness;
    const energyBefore = npc.physiology.availableEnergyKcal;
    const metabolizedBefore = npc.physiology.totals.metabolizedKcal;
    let completed = null;
    let steps = 0;
    for (let tick = 0; tick < 60 * 15; tick += 1) {
      session.tick(CONFIG.fixedStep);
      steps += 1;
      completed = actionEvents(npc).find(event =>
        event.details.action?.type === 'move' &&
        event.details.action?.target?.x === SHALLOW.x &&
        event.details.action?.target?.y === SHALLOW.y &&
        event.details.result?.code === 'ARRIVED');
      if (completed) break;
    }
    assert.ok(completed, 'the existing discovery controller selected and finished the shallow move');
    assert.equal(actionEvents(npc)[0], completed,
      'the shallow frontier was Aster\'s first completed action');
    assert.ok(npc.memory.experience.some(event => event.type === 'decision' &&
      event.id < completed.id && event.details.provider === 'discovery-learner'),
    'an autonomous discovery decision preceded the action receipt');
    assert.deepEqual(completed.details.startPosition, BANK);
    assert.equal(npc.lastResult.eventId, completed.id);
    assert.equal(npc.lastResult.at, completed.at);
    assert.equal(geometry.classify(npc.position.x, npc.position.y).reason, 'shallow-water');
    assert.ok(npc.thermal.wetness > wetnessBefore, 'the body became wet through actual wading');
    assert.ok(npc.physiology.availableEnergyKcal < energyBefore,
      'movement charged the body');
    assert.ok(npc.physiology.totals.metabolizedKcal > metabolizedBefore);
    const idle = createOzarkWadingAgentSession(geometry, { position: BANK, seed: CONFIG.seed });
    try {
      idle.npc.nextDecisionAt = Infinity;
      for (let tick = 0; tick < steps; tick += 1) idle.tick(CONFIG.fixedStep);
      assert.ok(npc.physiology.totals.metabolizedKcal >
        idle.npc.physiology.totals.metabolizedKcal,
      'the same elapsed time at rest has less metabolic cost than the wade');
    } finally {
      idle.dispose();
    }
    assert.equal(completed.details.result.movement.footing, 'shallow-water');
    assert.equal(completed.details.result.movement.wetness, 'wetter');
    assert.equal(completed.details.result.movement.effort, 'rising');
    assert.ok(['free', 'resisted', 'strong'].includes(
      completed.details.result.movement.resistance));
    assert.deepEqual(npc.lastResult.movement, completed.details.result.movement);
    assert.ok(npc.memory.experience.length <= NPC_RULES.maxExperience);
    assert.ok(Object.keys(npc.memory.cells).length <= NPC_RULES.maxCells);
    assert.doesNotMatch(JSON.stringify(completed.details.result.movement),
      /depthProxy|surfaceWaterDistance|currentDirection|waterSeconds|energyKcal/);
  } finally {
    session.dispose();
  }
});

test('the same authoritative geometry permits wading but stops entry into deep water', () => {
  assert.equal(geometry.classify(SHALLOW.x, SHALLOW.y).reason, 'shallow-water');
  assert.equal(geometry.classify(DEEP.x, DEEP.y).walkable, false);
  const state = { player: { ...SHALLOW }, wetness: 0, effort: 0, elapsed: 0 };
  const receipts = [];
  for (let index = 0; index < 8; index += 1) {
    const moved = applyPilotMovement(geometry, state, { dx: 0, dy: -1, dt: .25 });
    receipts.push(moved.evidence);
    assert.equal(geometry.classify(state.player.x, state.player.y).reason,
      'shallow-water', 'swept collision kept the actor outside deep water');
  }
  assert.ok(state.wetness > 0 && state.effort > 0);
  assert.ok(receipts.some(receipt => receipt.result.code === 'PARTIAL'));
  assert.ok(receipts.some(receipt => receipt.result.code === 'NEGLIGIBLE_PROGRESS'));
  assert.ok(receipts.every(receipt => receipt.result.wetness === 'wetter' &&
    receipt.result.effort === 'rising'));
  assert.ok(receipts.every(receipt => receipt.afterObservation.ground === 'shallow-water'));
  assert.doesNotMatch(JSON.stringify(receipts),
    /depthProxy|surfaceWaterDistance|currentDirection|waterSeconds|energyKcal/);

  // An explicit unobserved endpoint cannot borrow a nearby shallow cell's
  // observed status. The physical deep-water collision is checked above.
  const session = createOzarkWadingAgentSession(geometry, { position: BANK, seed: CONFIG.seed });
  try {
    const { npc } = session;
    for (let tick = 0; tick < 60 * 5 &&
        !actionEvents(npc).some(event =>
          event.details.action?.target?.y === SHALLOW.y &&
          event.details.result?.code === 'ARRIVED'); tick += 1) {
      session.tick(CONFIG.fixedStep);
    }
    assert.equal(geometry.classify(npc.position.x, npc.position.y).reason,
      'shallow-water');
    const before = { ...npc.position };
    const refusal = requestNpcAction(npc, { type: 'move', target: DEEP },
      session.environment);
    assert.equal(refusal.code, 'UNOBSERVED_TARGET');
    assert.equal(npc.active, null);
    assert.equal(npc.lastResult.code, 'UNOBSERVED_TARGET');
    assert.deepEqual(npc.position, before);
    assert.equal(geometry.classify(npc.position.x, npc.position.y).reason,
      'shallow-water', 'Aster did not enter deep water');
    const blockedEvent = actionEvents(npc).at(-1);
    assert.deepEqual(blockedEvent.details.action.target, DEEP);
    assert.equal(blockedEvent.details.result.code, 'UNOBSERVED_TARGET');
    assert.ok(npc.memory.experience.length <= NPC_RULES.maxExperience);
  } finally {
    session.dispose();
  }
});

test('the same river current moves an idle Aster without inventing a move action', () => {
  const session = createOzarkWadingAgentSession(geometry, { position: BANK });
  try {
    const { npc } = session;
    for (let tick = 0; tick < 60 * 5 &&
        !actionEvents(npc).some(event => event.details.result?.code === 'ARRIVED'); tick += 1) {
      session.tick(CONFIG.fixedStep);
    }
    assert.equal(geometry.classify(npc.position.x, npc.position.y).reason, 'shallow-water');
    const expected = { ...npc.position };
    const before = { ...npc.position };
    const count = actionEvents(npc).length;
    npc.nextDecisionAt = Infinity;
    for (let tick = 0; tick < 60; tick += 1) {
      geometry.advance(expected, 0, 0, CONFIG.fixedStep);
      session.tick(CONFIG.fixedStep);
    }
    assert.ok(Math.hypot(npc.position.x - before.x, npc.position.y - before.y) > 1,
      'a current can move the body without a chosen move');
    assert.ok(Math.hypot(npc.position.x - expected.x, npc.position.y - expected.y) < .001,
      'idle agent drift matches the player pilot geometry');
    assert.equal(actionEvents(npc).length, count,
      'passive drift did not fabricate an intentional action');
  } finally {
    session.dispose();
  }
});

test('recovery searches Ozark walkability rather than historical valley terrain', () => {
  const session = createOzarkWadingAgentSession(geometry, { position: BANK });
  try {
    const { npc } = session;
    const shallow = { x: -1130, y: 210 };
    assert.equal(geometry.classify(shallow.x, shallow.y).reason, 'shallow-water');
    npc.position = { ...shallow };
    npc.lifecycle = 'COLLAPSED';
    npc.collapseId = 1;
    npc.rescuedCollapseId = 0;
    npc.health = 0;
    npc.physiology.health = 0;
    assert.equal(rescueNpc(npc, 1).code, 'RESCUED');
    assert.deepEqual(npc.position, shallow,
      'an Ozark-walkable shallow position needs no historical valley relocation');
    assert.equal(geometry.classify(npc.position.x, npc.position.y).walkable, true);
  } finally {
    session.dispose();
  }
});

test('the isolated agent pilot has no save path or access to an original world', () => {
  assert.equal(OZARK_WALKING_PILOT_PROFILE.scope, 'fresh-session-unsaved');
  assert.throws(() => freshState({ geometryProfile: OZARK_WALKING_PILOT_PROFILE }));
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { assert.fail('agent pilot accessed a saved world'); },
  });
  try {
    const session = createOzarkWadingAgentSession(geometry, { position: BANK });
    try {
      assert.equal(typeof session.save, 'undefined');
      for (let index = 0; index < 120; index += 1) session.tick(CONFIG.fixedStep);
    } finally {
      session.dispose();
    }
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
});

test.todo('separate gate: compare learned shoreline choices with an ablated no-learning baseline');
test.todo('separate gate: persist a reviewed full Ozark world and verify exact write/load continuity');
