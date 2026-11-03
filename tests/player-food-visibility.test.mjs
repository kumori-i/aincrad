import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, loadOzarkSave, writeOzarkSave,
  OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { createPlayerFoodController } from '../src/player-food.js';
import { playerHeldFoodProjection, sensePublicPlayerFood,
  recordPublicPlayerFood, readPublicPlayerFood,
  clearPublicPlayerFood } from '../src/player-food-visibility.js';
import { lookupEcologyObject, renderEcology } from '../src/ecology.js';
import { npcEffortCost } from '../src/npc-effort-funding.js';
import { tickNpc } from '../src/npc.js';
import { PopulationRuntime } from '../src/population.js';

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
const near = (a, b, tolerance = 1e-6) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

function fixture() {
  const base = createOzarkWorldGeometry();
  let blocked = null, observer = null, state = null;
  const geometry = Object.freeze({ ...base,
    lineOfSight(from, to) {
      if (observer && near(from, observer.position) &&
          !near(from, state.player)) {
        if (blocked === 'player' && near(to, state.player)) return false;
        if (blocked === 'hand' && near(to,
          {x: state.player.x + 18, y: state.player.y - 29})) return false;
        if (blocked === 'reach' && near(to, source.position)) return false;
        if (blocked === 'reach-middle' && near(to,
          {x:(state.player.x + source.position.x) / 2,
            y:(state.player.y + source.position.y) / 2})) return false;
      }
      return base.lineOfSight(from, to);
    },
  });
  state = createOzarkState(geometry, {communicationSeed: 211});
  const ecology = state.environment.ecology;
  let source = null, playerPoint = null, observerPoint = null;
  for (const plant of ecology.plants.filter(row => row.kind === 'apple_tree' &&
      row.stage === 'ripe' && row.quantity > 2).sort((a, b) =>
      Math.hypot(a.position.x - 276, a.position.y - 760) -
      Math.hypot(b.position.x - 276, b.position.y - 760))) {
    const places = Array.from({length: 16}, (_, index) => ({
      x: plant.position.x + 48 * Math.cos(index * Math.PI / 8),
      y: plant.position.y + 48 * Math.sin(index * Math.PI / 8),
    })).filter(point => geometry.canOccupy(point.x, point.y, CONFIG.playerRadius) &&
      base.lineOfSight(point, plant.position));
    if (places.length < 2) continue;
    const second = places.find(point => point !== places[0] &&
      base.lineOfSight(point, places[0]));
    if (second) { source = plant; playerPoint = places[0]; observerPoint = second; break; }
  }
  assert.ok(source && playerPoint && observerPoint,
    'A real ripe tree and two dry mutually visible positions are required');
  state.player = {...playerPoint};
  state.elapsed = state.environment.elapsed = ecology.elapsed = 60;
  observer = state.agents[0];
  for (const actor of state.agents) {
    actor.elapsed = 60;
    if (actor === observer) actor.position = {...observerPoint};
    bindOzarkWorldAgent(actor, geometry, state);
  }
  const controller = createPlayerFoodController(state, geometry);
  function step() {
    const dt = .1;
    state.elapsed += dt;
    state.environment.elapsed = ecology.elapsed = state.elapsed;
    const result = controller.tick(dt);
    for (const actor of state.agents) tickNpc(actor, dt, state.environment);
    return result;
  }
  function finish() {
    for (let i = 0; i < 120; i++) {
      const result = step();
      if (result) return result;
    }
    assert.fail('Paid player pull did not finish');
  }
  return {state, geometry, ecology, source, observer, controller, step, finish,
    block: value => {blocked = value;},
    dispose: () => {clearPublicPlayerFood(observer); controller.dispose();}};
}

test('a certified pull projects only public reach geometry; sprite and sensor use the same real held fruit', () => {
  const f = fixture();
  try {
    const stock = f.source.quantity;
    const energy = f.state.playerFood.physiology.availableEnergyKcal;
    const spent = f.state.playerFood.physiology.totals.metabolizedKcal;
    assert.equal(f.controller.publicPose(), null);
    assert.equal(f.controller.start('pull', f.source.id).code, 'ACTION_STARTED');
    assert.equal(f.controller.publicPose(), null, 'Admission alone is no visible paid work');
    assert.equal(f.step(), null);
    const pose = f.controller.publicPose();
    assert.deepEqual(Object.keys(pose).sort(), ['origin','progress','scene','tip']);
    assert.deepEqual(pose.origin, f.state.player);
    assert.deepEqual(pose.tip, f.source.position);
    assert.ok(pose.progress > 0 && pose.progress < 1);
    assert.equal(f.source.quantity, stock, 'A partial reach cannot detach fruit');
    const atWork = recordPublicPlayerFood(f.observer, f.state, pose);
    assert.equal(atWork.visibility, 'visible');
    assert.equal(atWork.reach.status, 'pose');
    assert.equal(atWork.hand.status, 'visible');
    assert.deepEqual(atWork.hand.items, []);
    assert.ok(Math.hypot(atWork.reach.geometry.tip.dx,
      atWork.reach.geometry.tip.dy) <= NPC_RULES.visionRadius);
    const immutable = JSON.stringify(f.state);
    atWork.reach.geometry.tip.dx = 1e9;
    assert.notEqual(readPublicPlayerFood(f.observer).reach.geometry.tip.dx, 1e9);
    assert.deepEqual(recordPublicPlayerFood(f.observer, f.state, pose),
      readPublicPlayerFood(f.observer));
    assert.equal(JSON.stringify(f.state), immutable,
      'Observation and defensive reads cannot charge work, move matter or train');

    const result = f.finish();
    assert.equal(result.ok, true);
    close(result.durationSeconds, DISCOVERY_RULES.durations.pull);
    close(result.paidKcal, npcEffortCost(DISCOVERY_RULES.durations.pull,
      DISCOVERY_RULES.effort.pull));
    close(energy - f.state.playerFood.physiology.availableEnergyKcal,
      result.paidKcal);
    close(f.state.playerFood.physiology.totals.metabolizedKcal - spent,
      result.paidKcal);
    assert.equal(f.source.quantity, stock - 1);
    assert.equal(f.controller.publicPose(), null);
    const fruit = lookupEcologyObject(f.ecology, result.materialId);
    assert.equal(fruit?.heldBy, 'player');
    assert.equal(renderEcology(f.ecology, 'valley').some(row => row.id === fruit.id), false,
      'Ordinary ground sprites still exclude held matter');
    const projection = playerHeldFoodProjection(f.state);
    assert.equal(projection.complete, true);
    assert.equal(projection.items.length, 1);
    assert.equal(projection.items[0].id, fruit.id);
    const seen = recordPublicPlayerFood(f.observer, f.state, f.controller.publicPose());
    assert.equal(seen.reach.status, 'absent');
    assert.equal(seen.hand.status, 'visible');
    assert.equal(seen.hand.items.length, 1);
    assert.equal(seen.hand.items[0].id, fruit.id);
    assert.deepEqual(seen.hand.items[0].appearance, projection.items[0].appearance);
    assert.deepEqual({x: f.observer.position.x + seen.hand.items[0].position.dx,
      y: f.observer.position.y + seen.hand.items[0].position.dy},
    {x: projection.items[0].sprite.x, y: projection.items[0].sprite.y},
    'The actor senses the same public position used by the drawn sprite');
    assert.equal(JSON.stringify(seen).includes('materialType'), false);
    assert.equal(JSON.stringify(seen).includes('energyKcal'), false);
    assert.equal(JSON.stringify(seen).includes('heldBy'), false);
    assert.equal(JSON.stringify(seen).includes('smell'), false,
      'A sight-only hand row cannot borrow an unsampled scent');
    assert.equal(JSON.stringify(seen).includes(f.source.id), false,
      'A visible fruit carries no hidden parent-tree binding');
    for (const actor of f.state.agents)
      assert.equal(actor.discovery.inquiries.some(row =>
        row.actorId === 'player' && row.sourceId === f.source.id), false,
      'Seeing paid motion and held fruit alone creates no tree lesson');
  } finally { f.dispose(); }
});

test('observer-only occlusion becomes unknown without cancelling a still-funded player pull', () => {
  const f = fixture();
  try {
    const stock = f.source.quantity;
    const energy = f.state.playerFood.physiology.availableEnergyKcal;
    const spent = f.state.playerFood.physiology.totals.metabolizedKcal;
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.step();
    const pose = f.controller.publicPose();
    assert.ok(pose);
    f.block('player');
    assert.equal(sensePublicPlayerFood(f.observer, f.state, pose).visibility,
      'unknown');
    f.block('reach');
    const reachHidden = sensePublicPlayerFood(f.observer, f.state, pose);
    assert.equal(reachHidden.visibility, 'visible');
    assert.equal(reachHidden.reach.status, 'unknown');
    assert.equal(reachHidden.hand.status, 'visible');
    f.block('reach-middle');
    assert.equal(sensePublicPlayerFood(f.observer, f.state, pose).reach.status,
      'unknown', 'A sampled occluded portion of the physical reach is unknown');
    f.block('hand');
    const handHidden = sensePublicPlayerFood(f.observer, f.state, pose);
    assert.equal(handHidden.reach.status, 'pose');
    assert.equal(handHidden.hand.status, 'unknown');
    f.block(null);
    assert.equal(f.source.quantity, stock);
    assert.equal(f.step(), null,
      'Only the observer is occluded; the player remains able to work');
    assert.ok(f.controller.publicPose());
    const interrupted = f.controller.cancel();
    assert.equal(interrupted.ok, false);
    assert.ok(interrupted.durationSeconds > 0 && interrupted.paidKcal > 0);
    close(energy - f.state.playerFood.physiology.availableEnergyKcal,
      interrupted.paidKcal);
    close(f.state.playerFood.physiology.totals.metabolizedKcal - spent,
      interrupted.paidKcal);
    assert.equal(f.controller.publicPose(), null);
    assert.equal(f.controller.cancel(), null);
    assert.equal(f.source.quantity, stock);
    assert.deepEqual(playerHeldFoodProjection(f.state).items, []);
    assert.equal(sensePublicPlayerFood(f.observer, f.state).reach.status, 'absent',
      'Visible lack of a current pose is different from occlusion');
    f.state.elapsed += .1;
    f.observer.elapsed = f.state.elapsed;
    assert.equal(readPublicPlayerFood(f.observer), null,
      'The old actor-local row cannot be read at a later time');
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.step();
    assert.ok(f.controller.publicPose());
    f.state.player.x += 1;
    assert.equal(f.controller.publicPose(), null,
      'Movement cancels the public reach before the next paid tick');
    assert.equal(f.step().code, 'ACTION_INTERRUPTED');
    assert.equal(f.source.quantity, stock);
  } finally { f.dispose(); }
});

test('cancelled pending work cannot survive reopening; a completed held fruit does', () => {
  const f = fixture();
  try {
    const initialStock = f.source.quantity;
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.step();
    assert.ok(f.controller.publicPose());
    const paid = f.controller.cancel();
    assert.ok(paid.paidKcal > 0);
    assert.equal(f.source.quantity, initialStock);
    assert.deepEqual(f.state.playerFood.inventory.items, []);
    const bytes = new Map();
    const disk = {getItem: key => bytes.get(key) ?? null,
      setItem: (key, value) => bytes.set(key, value)};
    assert.equal(writeOzarkSave(disk, f.state, f.geometry), true);
    const cancelled = loadOzarkSave(disk, f.geometry);
    assert.equal(cancelled.blocked, false, cancelled.error);
    assert.deepEqual(cancelled.state.playerFood.inventory.items, []);
    assert.equal(cancelled.state.environment.ecology.plants.find(row =>
      row.id === f.source.id).quantity, initialStock);
    const cancelledController = createPlayerFoodController(cancelled.state, f.geometry);
    assert.equal(cancelledController.publicPose(), null);
    cancelledController.dispose();
    close(cancelled.state.playerFood.physiology.totals.metabolizedKcal,
      f.state.playerFood.physiology.totals.metabolizedKcal);
    const restarted = f.controller.start('pull', f.source.id);
    assert.equal(restarted.ok, true);
    const completed = f.finish();
    assert.equal(completed.ok, true);
    assert.equal(f.source.quantity, initialStock - 1);
    const projection = playerHeldFoodProjection(f.state);
    assert.equal(projection.items.length, 1);

    assert.equal(writeOzarkSave(disk, f.state, f.geometry), true);
    const saved = JSON.parse(bytes.get(OZARK_SAVE_KEY));
    assert.deepEqual(Object.keys(saved.playerFood).sort(),
      ['inventory','physiology','version']);
    assert.deepEqual(saved.playerFood.inventory.items, [completed.materialId]);
    const loaded = loadOzarkSave(disk, f.geometry);
    assert.equal(loaded.blocked, false, loaded.error);
    const reopened = createPlayerFoodController(loaded.state, f.geometry);
    try {
      assert.equal(reopened.publicPose(), null);
      assert.equal(reopened.snapshot().active, null);
      assert.deepEqual(reopened.snapshot().held, [completed.materialId]);
      assert.deepEqual(playerHeldFoodProjection(loaded.state).items,
        projection.items, 'The sprite follows actual durable matter, not saved pose state');
      assert.equal(readPublicPlayerFood(loaded.state.agents[0]), null,
        'No actor-local sight row is loaded from disk');
    } finally { reopened.dispose(); }
  } finally { f.dispose(); }
});

test('enabling actor-local food sight leaves world actions, RNG and learners identical', () => {
  const f = fixture();
  const shadow = structuredClone(f.state);
  for (const actor of shadow.agents)
    bindOzarkWorldAgent(actor, f.geometry, shadow);
  const shadowFood = createPlayerFoodController(shadow, f.geometry);
  const enabled = new PopulationRuntime(f.state, {cardinal:false,
    playerFoodReach: () => f.controller.publicPose()});
  const disabled = new PopulationRuntime(shadow, {cardinal:false});
  try {
    assert.deepEqual(shadow, f.state);
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    assert.equal(shadowFood.start('pull', f.source.id).ok, true);
    for (let i = 0; i < 12; i++) {
      f.state.elapsed += .1;
      shadow.elapsed += .1;
      assert.deepEqual(f.controller.tick(.1), shadowFood.tick(.1));
      enabled.tick(.1);
      disabled.tick(.1);
      assert.deepEqual(f.state, shadow,
        'Read-only actor sight cannot change decisions, RNG or learner state');
    }
    assert.equal(readPublicPlayerFood(f.state.agents[0])?.reach.status, 'pose');
    assert.equal(readPublicPlayerFood(shadow.agents[0]), null);
  } finally {enabled.dispose(); disabled.dispose(); shadowFood.dispose(); f.dispose();}
});

test('the ordinary population tick records each actor’s own current sight without entering policy', () => {
  const f = fixture();
  let population = null;
  try {
    population = new PopulationRuntime(f.state, {cardinal:false,
      playerFoodReach: () => f.controller.publicPose()});
    assert.equal(f.controller.start('pull', f.source.id).ok, true);
    f.state.elapsed += CONFIG.fixedStep;
    assert.equal(f.controller.tick(CONFIG.fixedStep), null);
    population.tick(CONFIG.fixedStep);
    const row = readPublicPlayerFood(f.observer);
    assert.equal(row?.reach.status, 'pose');
    assert.equal(row?.hand.status, 'visible');
    assert.deepEqual(row?.hand.items, []);
    const before = JSON.stringify(f.state);
    row.reach.geometry.origin.dx = 1e9;
    assert.notEqual(readPublicPlayerFood(f.observer).reach.geometry.origin.dx, 1e9);
    assert.equal(JSON.stringify(f.state), before,
      'Reading actor-local sight does not affect actions or state');
    population.dispose();
    population = null;
    assert.equal(readPublicPlayerFood(f.observer), null,
      'Disposal clears current actor-local sight');
  } finally { population?.dispose(); f.dispose(); }
});
