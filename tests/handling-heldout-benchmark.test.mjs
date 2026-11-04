import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { validateOzarkEcology } from '../src/ozark-ecology.js';
import { createOzarkState } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { tickEnvironment } from '../src/environment.js';
import { discoveryDecision, freshMethodAppearance } from '../src/discovery.js';
import { handlingInquiries, HANDLING_QUESTION } from '../src/handling-inquiry.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';

// Engineering benchmark, not an autonomous survival or learned-policy trial.
// Fixed matrix and interventions: docs/HANDLING-HELDOUT-BENCHMARK.md.
const geometry = createOzarkWorldGeometry();
const CONDITIONS = [
  { appearance: 'same', stock: 'stocked' },
  { appearance: 'different', stock: 'stocked' },
];
const STEP = .1, MAX_STEPS = 700;

function encounter(state, appearance) {
  const plants = state.environment.ecology.plants;
  for (const source of plants.filter(p => p.kind === 'apple_tree' && p.quantity > 2)) {
    for (const target of plants.filter(p => p.kind === 'apple_tree' && p.quantity > 2)) {
      const gap = Math.hypot(source.position.x - target.position.x, source.position.y - target.position.y);
      const start = { x: source.position.x + 45, y: source.position.y };
      const end = { x: target.position.x + 45, y: target.position.y };
      if (gap > 120 && gap < 260 && [start, end].every(p => geometry.canOccupy(p.x, p.y, CONFIG.playerRadius)) &&
          geometry.lineOfSight(start, source.position) && geometry.lineOfSight(end, source.position) && geometry.lineOfSight(end, target.position)) {
        return { source, target, start, end };
      }
    }
  }
  assert.fail(`No fixed ${appearance}-appearance encounter; do not search by evaluation outcome`);
}

function fixture(condition) {
  const state = createOzarkState(geometry, { communicationSeed: 51001 });
  const actor = state.agents[0], environment = state.environment;
  const { source, target, start, end } = encounter(state, condition.appearance);
  if (condition.appearance === 'different') target.stage = 'flowering';
  const validated = validateOzarkEcology(environment.ecology, geometry, { seed: environment.seed, elapsed: 0 });
  const validatedTarget = validated.plants.find(p => p.id === target.id);
  assert.equal(validatedTarget.stage, target.stage, 'Authored stage survives actual world validation');
  assert.equal(validatedTarget.quantity, target.quantity);
  state.elapsed = environment.elapsed = environment.ecology.elapsed = actor.elapsed = 60;
  actor.position = start;
  bindOzarkWorldAgent(actor, geometry, state);
  const finish = action => {
    const admitted = requestNpcAction(actor, action, environment);
    if (admitted.code !== 'ACTION_STARTED') return { status: 'rejected', result: admitted };
    for (let i = 0; actor.active && i < MAX_STEPS; i++) {
      tickEnvironment(environment, STEP);
      state.elapsed = environment.ecology.elapsed = environment.elapsed;
      tickNpc(actor, STEP, environment);
    }
    return actor.active ? { status: 'unfinished-at-cap', result: null } : { status: 'completed', result: actor.lastResult };
  };
  observeNpc(actor, environment);
  const training = finish({ type: 'pull', targetId: source.id });
  assert.equal(training.result?.code, 'piece_detached');
  // Target is held out from action training, not necessarily from passive sight.
  assert.ok(!actor.discovery.experiments.some(e => e.targetId === target.id));
  actor.position = end; // Placement intervention, not claimed as paid navigation.
  observeNpc(actor, environment);
  const prior = freshMethodAppearance(actor, source.id), heldout = freshMethodAppearance(actor, target.id);
  assert.ok(prior && heldout, 'Both actual sensory receipts must be fresh');
  assert.equal(JSON.stringify(prior.cues) === JSON.stringify(heldout.cues), condition.appearance === 'same');
  const failed = finish({ type: 'grasp', targetId: target.id });
  assert.equal(failed.result?.code, 'object_still_attached');
  assert.equal(actor.discovery.handlingQuestions.length, condition.appearance === 'same' ? 1 : 0);
  assert.ok(!actor.discovery.experiments.some(e => e.targetId === target.id && e.primitive === 'pull'));
  return { state, actor, source, target, finish };
}

function costs(f) {
  return { seconds: f.actor.elapsed, kcal: f.actor.physiology.totals.metabolizedKcal,
    stock: f.target.quantity, held: f.actor.inventory.items.length };
}

test('fixed held-out handling matrix records one actual paid choice per matched selector arm', async t => {
  const rows = [];
  for (const condition of CONDITIONS) await t.test(`${condition.appearance}/${condition.stock}`, cell => {
    let matched;
    const pair = [];
    for (const enabled of [false, true]) {
      const f = fixture(condition), beforeState = structuredClone(f.state);
      // Fresh-world UUIDs are nondeterministic identity only, not policy inputs.
      // Normalize only these four exact fields, never any actor, RNG or evidence.
      beforeState.worldLineage.instanceId = 'paired-world';
      beforeState.playerLessons.worldId = 'paired-world';
      beforeState.visualReference.worldId = 'paired-world';
      beforeState.characterMessages.worldId = 'paired-world';
      if (matched) assert.deepEqual(beforeState, matched, 'Trained state including RNG must match except fresh-world UUID');
      else matched = beforeState;
      const before = costs(f), rngBefore = f.actor.rng;
      const decision = discoveryDecision(f.actor, { handlingCuriosity: enabled });
      const selectedByHandling = decision.reason === HANDLING_QUESTION;
      const outcome = f.finish(decision.action), after = costs(f);
      const row = { ...condition, enabled, sourceId: f.source.id, targetId: f.target.id,
        rngBefore, action: decision.action, selectedByHandling, status: outcome.status,
        code: outcome.result?.code ?? null, elapsed: after.seconds - before.seconds,
        metabolizedKcal: after.kcal - before.kcal, targetStockReduction: before.stock - after.stock,
        heldDelta: after.held - before.held, inquiryStatus: handlingInquiries(f.actor)[0]?.status ?? null };
      rows.push(row); pair.push(row);
      // Report even a failing arm before assertions. Never reroll a failed choice.
      cell.diagnostic(JSON.stringify(row));
      assert.equal(selectedByHandling, enabled && condition.appearance === 'same');
      assert.equal(outcome.status, 'completed', 'One bounded chosen action must settle, without retry');
      assert.ok(row.elapsed > 0 && row.metabolizedKcal > 0);
      assert.equal(retainedProofIntegrityError(f.actor), null);
      assert.deepEqual(f.actor.discovery.techniques, [], 'No food technique is earned by mere detachment');
      if (selectedByHandling) {
        assert.deepEqual(decision.action, { type: 'pull', targetId: f.target.id });
        assert.equal(row.code, 'piece_detached');
        assert.equal(row.targetStockReduction, 1);
        assert.equal(row.heldDelta, 1);
        assert.equal(row.inquiryStatus, 'detached');
      }
    }
    if (condition.appearance === 'different') {
      const strip = ({ enabled, ...row }) => row;
      assert.deepEqual(strip(pair[0]), strip(pair[1]), 'Ineligible appearance must leave choice and outcome unchanged');
    }
  });
  assert.equal(rows.length, 4, 'All predefined cells and both arms are reported');
});
