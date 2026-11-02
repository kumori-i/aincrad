import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { createPlayerFoodController } from '../src/player-food.js';
import { PopulationRuntime } from '../src/population.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { observationalExperiment, observationalInquiries, priorAdverseSource } from '../src/observational-learning.js';
import { lookupEcologyObject } from '../src/ecology.js';
import { validInquiries } from '../src/observational-inquiry-state.js';

function fixture(kind = 'apple_tree') {
  const base = createOzarkWorldGeometry();
  let visible = true;
  const geometry = Object.freeze({ ...base,
    lineOfSight: (from, to) => visible && base.lineOfSight(from, to) });
  const state = createOzarkState(geometry, { communicationSeed: 211 });
  const [aster, mira] = state.agents;
  const environment = state.environment;
  let source, point;
  for (const plant of environment.ecology.plants.filter(p => p.kind === kind &&
    p.quantity > 2 && p.stage === 'ripe').sort((a, b) =>
    Math.hypot(a.position.x - 276, a.position.y - 760) -
    Math.hypot(b.position.x - 276, b.position.y - 760))) {
    point = Array.from({ length: 16 }, (_, i) => ({
      x: plant.position.x + 48 * Math.cos(i * Math.PI / 8),
      y: plant.position.y + 48 * Math.sin(i * Math.PI / 8),
    })).find(p => geometry.canOccupy(p.x, p.y, CONFIG.playerRadius) &&
      geometry.lineOfSight(p, plant.position));
    if (point) { source = plant; break; }
  }
  assert.ok(source, `A reachable ripe ${kind} is required`);
  state.player = { ...point };
  state.elapsed = environment.elapsed = environment.ecology.elapsed = 60;
  for (const npc of state.agents) {
    npc.elapsed = 60;
    npc.position = { ...point };
    bindOzarkWorldAgent(npc, geometry, state);
    observeNpc(npc, environment);
  }
  // Population owns the real synchronous consumption subscription. Clock
  // stepping below uses the ordinary paid action ticks without running an
  // autonomous policy between the authored encounter and its controlled read.
  const population = new PopulationRuntime(state, { cardinal: false });
  const player = createPlayerFoodController(state, geometry);
  const step = () => {
    const dt = .1;
    state.elapsed += dt;
    environment.elapsed = state.elapsed;
    environment.ecology.elapsed = state.elapsed;
    const playerResult = player.tick(dt);
    for (const npc of state.agents) tickNpc(npc, dt, environment);
    return playerResult;
  };
  const advance = seconds => { for (let i = 0; i < Math.ceil(seconds / .1); i++) step(); };
  const finishPlayer = (type, targetId) => {
    const start = player.start(type, targetId);
    assert.equal(start.code, 'ACTION_STARTED', JSON.stringify(start));
    for (let i = 0; i < 120; i++) {
      const result = step();
      if (result) return result;
    }
    assert.fail(`Player ${type} did not finish`);
  };
  const finishNpc = (npc, action) => {
    const admitted = requestNpcAction(npc, action, environment);
    assert.equal(admitted.code, 'ACTION_STARTED', JSON.stringify(admitted));
    for (let i = 0; npc.active && i < 120; i++) step();
    assert.equal(npc.active, null);
    return npc.lastResult;
  };
  return { state, geometry, aster, mira, environment, source, point, player,
    step, advance, finishPlayer, finishNpc, setVisible: value => { visible = value; },
    dispose: () => { player.dispose(); population.dispose(); } };
}

function playerDemonstrates(f) {
  const acquired = f.finishPlayer('pull', f.source.id);
  assert.equal(acquired.ok, true);
  const materialId = acquired.materialId;
  assert.ok(f.state.playerFood.inventory.items.includes(materialId));
  const sampled = f.finishPlayer('sample', materialId);
  assert.equal(sampled.ok, true, JSON.stringify(sampled));
  assert.ok(sampled.ingestionId);
  return materialId;
}

const disk = () => {
  const rows = new Map();
  return { getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value) };
};

test('only the exact player actor ID is admitted for a retained witnessed-consumption inquiry', () => {
  const inquiry = {
    sourceId: 'object:7', actorId: 'player', at: 10,
    actorPosition: { x: 100, y: 100 }, sourcePosition: { x: 100, y: 100 },
    attempts: [], retired: false,
  };
  const discovery = { experiments: [] };
  assert.equal(validInquiries([inquiry], discovery, 10, 'aster'), true);
  for (const actorId of ['Player', 'human', 'player:1', '', 'aster']) {
    assert.equal(validInquiries([{ ...inquiry, actorId }], discovery, 10, 'aster'), false, actorId);
  }
  assert.equal(validInquiries([{ ...inquiry, sourcePosition: { x: 181, y: 100 } }], discovery, 10, 'aster'), false);
});

test('a witnessed player apple bite creates only an exact-source question; the agent earns its own paid result', () => {
  const f = fixture();
  try {
    const materialId = playerDemonstrates(f);
    const question = observationalInquiries(f.mira).find(q => q.sourceId === materialId);
    assert.equal(question?.actorId, 'player');
    assert.equal(question?.status, 'uncertain');
    assert.deepEqual(question?.ownAttempts, []);
    assert.deepEqual(question?.ownEffects, []);
    assert.equal(f.mira.discovery.techniques.length, 0);
    assert.equal(f.mira.discovery.effects.length, 0);
    assert.equal(f.mira.discovery.inquiries.length, 1);

    // Watching a held bite supplies no right to take the player's hand-held
    // remainder. The player must really release it, then Mira must see it.
    observeNpc(f.mira, f.environment);
    assert.notDeepEqual(discoveryDecision(f.mira).action,
      { type: 'grasp', targetId: materialId });
    assert.equal(f.finishPlayer('release', materialId).ok, true);
    f.state.player = { ...f.geometry.spawn }; // Teacher leaves after release.
    f.advance(.2);
    observeNpc(f.mira, f.environment);
    let decision = discoveryDecision(f.mira);
    assert.deepEqual(decision.action, { type: 'grasp', targetId: materialId });
    assert.equal(f.finishNpc(f.mira, decision.action).ok, true);
    decision = discoveryDecision(f.mira);
    assert.deepEqual(decision.action, { type: 'sample', targetId: materialId });
    assert.equal(f.finishNpc(f.mira, decision.action).ok, true);
    assert.equal(observationalInquiries(f.mira)[0].status, 'waiting');
    assert.equal(f.mira.discovery.effects.length, 0);
    f.advance(100);
    processDiscoveryFeedback(f.mira);
    const earned = observationalInquiries(f.mira)[0];
    assert.equal(earned.status, 'supported');
    assert.ok(earned.ownEffects.every(e => e.source === 'experienced'));
    assert.ok(earned.ownAttempts.some(e => e.primitive === 'grasp' && e.ok));
    assert.ok(earned.ownAttempts.some(e => e.primitive === 'sample' && e.ok));

    const storage = disk();
    assert.equal(writeOzarkSave(storage, f.state, f.geometry), true);
    const loaded = loadOzarkSave(storage, f.geometry);
    assert.equal(loaded.blocked, false);
    assert.deepEqual(loaded.state.agents[1].discovery.inquiries,
      f.mira.discovery.inquiries);
    assert.equal(createOzarkState(f.geometry, { communicationSeed: 211 })
      .agents.every(n => n.discovery.inquiries.length === 0), true);
  } finally { f.dispose(); }
});

test('a real player berry bite records only its individual material, without category transfer', () => {
  const f = fixture('bramble');
  try {
    const materialId = playerDemonstrates(f);
    const inquiries = observationalInquiries(f.mira);
    assert.equal(inquiries.length, 1);
    assert.equal(inquiries[0].sourceId, materialId);
    assert.equal(inquiries[0].status, 'uncertain');
    assert.deepEqual(inquiries[0].ownEffects, []);
    assert.deepEqual(f.mira.discovery.techniques, []);
    const next = f.finishPlayer('pull', f.source.id);
    assert.equal(next.ok, true);
    assert.notEqual(next.materialId, materialId);
    assert.equal(observationalInquiries(f.mira).some(q =>
      q.sourceId === next.materialId), false);
  } finally { f.dispose(); }
});

test('occluded, absent and physically refused player consumption cannot be replayed into an inquiry', () => {
  for (const mode of ['occluded', 'no-demo', 'full-gut', 'interrupted']) {
    const f = fixture();
    try {
      const acquired = f.finishPlayer('pull', f.source.id);
      assert.equal(acquired.ok, true);
      const materialId = acquired.materialId;
      const material = lookupEcologyObject(f.environment.ecology, materialId);
      const mass = material.massGrams;
      const ingested = f.state.playerFood.physiology.totals.ingestedKcal;
      if (mode === 'occluded') f.setVisible(false);
      if (mode === 'full-gut')
        f.state.playerFood.physiology.stomach = [{ remainingMassGrams: 1e6 }];
      if (mode === 'interrupted') {
        assert.equal(f.player.start('sample', materialId).code, 'ACTION_STARTED');
        for (let i = 0; i < 5; i++) f.step();
        const cancelled = f.player.cancel();
        assert.equal(cancelled.ok, false);
        assert.ok(cancelled.durationSeconds > 0);
        assert.equal(material.massGrams, mass);
      } else if (mode !== 'no-demo') {
        const result = f.finishPlayer('sample', materialId);
        assert.equal(result.ok, mode === 'occluded', mode);
        if (mode === 'full-gut') {
          assert.equal(result.code, 'TOO_FULL');
          assert.equal(material.massGrams, mass);
          assert.equal(f.state.playerFood.physiology.totals.ingestedKcal, ingested);
        }
      }
      f.setVisible(true);
      f.advance(.2);
      observeNpc(f.mira, f.environment);
      assert.deepEqual(observationalInquiries(f.mira), [], mode);
    } finally { f.dispose(); }
  }
});

test('personal adverse feedback vetoes an observed player-source trial without assigning category danger', () => {
  const f = fixture();
  try {
    const materialId = playerDemonstrates(f);
    assert.equal(f.finishPlayer('release', materialId).ok, true);
    f.advance(.2);
    observeNpc(f.mira, f.environment);
    assert.deepEqual(discoveryDecision(f.mira).action,
      { type: 'grasp', targetId: materialId });
    assert.equal(f.finishNpc(f.mira,
      { type: 'grasp', targetId: materialId }).ok, true);
    lookupEcologyObject(f.environment.ecology, materialId).spoiled = true;
    assert.equal(f.finishNpc(f.mira,
      { type: 'sample', targetId: materialId }).ok, true);
    f.advance(100);
    processDiscoveryFeedback(f.mira);
    const question = observationalInquiries(f.mira)[0];
    assert.equal(question.status, 'contradicted');
    assert.equal(question.priorAdverse, true);
    assert.equal(priorAdverseSource(f.mira.discovery, materialId), true);
    assert.equal(observationalExperiment(f.mira, {
      body: { digestion: 'empty', stamina: 'easy breathing', energy: 'steady', pain: 'none' },
      eligible: () => true, blocked: () => false, currentlySeen: () => true,
    }), null);
  } finally { f.dispose(); }
});
