import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';
import { applyPilotMovement } from '../src/ozark-pilot-action-evidence.js';
import { createOzarkWadingAgentSession, OZARK_AGENT_BANK, OZARK_AGENT_SEED } from '../src/ozark-agent-session.js';
import { discoveryDecision } from '../src/discovery.js';
import { requestNpcAction, rescueNpc } from '../src/npc.js';
import { freshState } from '../src/world.js';

// Acceptance for the first agent slice only. These executable checks establish
// autonomous selection, physical contact and first-person evidence. A later
// experiment must compare learning against an ablated baseline. Save/load is
// deliberately unsupported while this is a fresh, isolated pilot geometry.
const BANK = OZARK_AGENT_BANK;
const SHALLOW = Object.freeze({ x: -1200, y: 240 });
const DEEP = Object.freeze({ x: -1200, y: 160 });
const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);

function actionEvents(npc) {
  return npc.memory.experience.filter(event => event.type === 'action');
}

test('fresh Aster autonomously chooses observed water and experiences a completed shallow move', () => {
  assert.equal(geometry.classify(BANK.x, BANK.y).reason, 'dry-ground');
  assert.equal(geometry.classify(SHALLOW.x, SHALLOW.y).reason, 'shallow-water');
  const session = createOzarkWadingAgentSession(geometry);
  try {
    const { npc } = session;
    assert.equal(npc.id, 'aster');
    assert.equal(npc.seed, OZARK_AGENT_SEED);
    assert.equal(npc.mode, 'discovery');
    assert.equal(npc.learning, true);
    assert.deepEqual(npc.memory.skills, []);
    assert.deepEqual(actionEvents(npc), []);
    assert.deepEqual(npc.discovery.experiments, []);
    assert.deepEqual(npc.memory.values, {});
    assert.deepEqual(npc.position, BANK);
    const observedWater = npc.memory.cells['-15,3'];
    assert.ok(observedWater, 'the shoreline is locally observed at the bank');
    assert.equal(observedWater.walkable, true);
    assert.equal(observedWater.terrain, 'surface-water',
      'the visual route has no certified safe-depth label');
    assert.ok(Math.hypot(observedWater.x - BANK.x, observedWater.y - BANK.y)
      <= NPC_RULES.visionRadius);
    for (const cell of Object.values(npc.memory.cells)) {
      assert.ok(Math.hypot(cell.x - BANK.x, cell.y - BANK.y)
        <= NPC_RULES.visionRadius, `cell ${cell.key} was not locally visible`);
      assert.equal(geometry.lineOfSight(BANK, cell), true,
        `cell ${cell.key} was hidden from the bank`);
    }
    assert.doesNotMatch(JSON.stringify(npc.memory.cells),
      /depthProxy|surfaceWaterDistance|waterBand|currentDirection|currentCue|elevation|shallow-water/);
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
    assert.ok(completed, 'the existing discovery controller selected and finished the water move');
    assert.equal(actionEvents(npc)[0], completed,
      'the observed water tile was Aster\'s first completed action');
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
    const idle = createOzarkWadingAgentSession(geometry);
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

test('the first destination comes from generic observed-cell exploration, without a water label or geometry query', () => {
  const observed = createOzarkWadingAgentSession(geometry);
  const relabeled = createOzarkWadingAgentSession(geometry);
  try {
    assert.equal(observed.npc.memory.cells['-15,3'].terrain, 'surface-water');
    let waterCount = 0;
    for (const cell of Object.values(relabeled.npc.memory.cells)) {
      if (cell.terrain !== 'surface-water') continue;
      cell.terrain = 'dry-ground';
      waterCount += 1;
    }
    assert.ok(waterCount > 1, 'the comparison removes every locally seen water label');
    const choice = discoveryDecision(observed.npc);
    const otherLabel = discoveryDecision(relabeled.npc);
    assert.deepEqual(choice.action, otherLabel.action,
      'a water-specific label must not determine the destination');
    assert.deepEqual(choice.action, { type: 'move', target: SHALLOW });
    assert.doesNotMatch(choice.reason, /shallow|water|current|depth/i);
  } finally {
    observed.dispose();
    relabeled.dispose();
  }

  let classifyCalls = 0;
  const guarded = { ...geometry,
    classify(...args) {
      classifyCalls += 1;
      assert.equal(classifyCalls, 1,
        'only the fresh spawn is physically validated before Aster acts');
      return geometry.classify(...args);
    },
  };
  const session = createOzarkWadingAgentSession(guarded);
  try {
    assert.equal(classifyCalls, 1);
    for (const key of ['sample', 'lineOfSight', 'advance', 'observe'])
      Object.defineProperty(guarded, key, { get() {
        assert.fail(`decision consulted hidden geometry through ${key}`);
      } });
    assert.deepEqual(discoveryDecision(session.npc).action,
      { type: 'move', target: SHALLOW });
  } finally {
    session.dispose();
  }
});

test('a sight-blocked water tile is neither remembered nor eligible as a first route', () => {
  const occluded = { ...geometry, lineOfSight(from, to) {
    if (to.x === SHALLOW.x && to.y === SHALLOW.y) return false;
    return geometry.lineOfSight(from, to);
  } };
  const session = createOzarkWadingAgentSession(occluded);
  try {
    assert.equal(session.npc.memory.cells['-15,3'], undefined);
    assert.notDeepEqual(discoveryDecision(session.npc).action,
      { type: 'move', target: SHALLOW });
    assert.equal(requestNpcAction(session.npc, { type: 'move', target: SHALLOW },
      session.environment).code, 'UNOBSERVED_TARGET');
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

  // The deep tile is also seen as water and is eligible for a trial. The
  // movement authority, not perception, must stop the attempted crossing.
  const session = createOzarkWadingAgentSession(geometry);
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
    assert.equal(npc.memory.cells['-15,2']?.terrain, 'surface-water');
    assert.equal(npc.memory.cells['-15,2']?.walkable, true);
    const refusal = requestNpcAction(npc, { type: 'move', target: DEEP },
      session.environment);
    assert.equal(refusal.code, 'STARTED');
    npc.nextDecisionAt = Infinity;
    for (let tick = 0; tick < 60 * 10 && npc.active; tick += 1)
      session.tick(CONFIG.fixedStep);
    assert.equal(npc.active, null);
    assert.equal(npc.lastResult.code, 'ROUTE_BLOCKED');
    assert.ok(Math.hypot(npc.position.x - before.x, npc.position.y - before.y) > 1,
      'Aster made a physical attempt before learning the route was blocked');
    assert.equal(geometry.classify(npc.position.x, npc.position.y).reason,
      'shallow-water', 'Aster did not enter deep water');
    const blockedEvent = actionEvents(npc).at(-1);
    assert.deepEqual(blockedEvent.details.action.target, DEEP);
    assert.equal(blockedEvent.details.result.code, 'ROUTE_BLOCKED');
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
