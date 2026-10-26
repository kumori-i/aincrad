import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, NPC_RULES, STARTER_NPC_SPAWN } from '../src/config.js';
import { BIOLOGY_RULES } from '../src/biology-config.js';
import { DISCOVERY_RULES } from '../src/discovery-config.js';
import { createNpc } from '../src/npc-state.js';
import { discoveryDecision, processDiscoveryFeedback } from '../src/discovery.js';
import { knownRoute } from '../src/navigation.js';
import { perceive, tileKey } from '../src/perception.js';
import { bodySignals } from '../src/interoception.js';
import { cognitiveAction } from '../src/cognition.js';
import { canStand, distance, freshState } from '../src/world.js';
import { waterSource, shelterSource } from '../src/resources.js';
import { createEnvironment, tickEnvironment } from '../src/environment.js';
import { tickEcology, lookupEcologyObject } from '../src/ecology.js';
import { ingestMaterial, projectPhysiology } from '../src/biology.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from '../src/npc.js';
import { validateNpc, recordEvent } from '../src/npc-memory.js';
import { PopulationRuntime } from '../src/population.js';

const actor = { x: 1280, y: 4560 };
const usefulEndpoint = { x: 1280, y: 4640 };
const waterAction = { type: 'move', target: usefulEndpoint };
const sourceId = 'river:east:33';
const routeLength = (from, route) => route.reduce((sum, point, i) => sum + distance(i ? route[i - 1] : from, point), 0);
const routeFor = (n, target) => knownRoute(n.memory.cells, n.position, target, 30, n.memory.blockedEdges, n.elapsed, n.navigationAnchor);

function riverFixture() {
  const n = createNpc({ mode: 'discovery', seed: 25 });
  n.position = { ...actor };
  n.elapsed = 100;
  n.discovery.search.home = { ...STARTER_NPC_SPAWN };
  const current = perceive(n);
  n.position = { x: 1360, y: 5200 };
  n.elapsed = 90;
  const prior = perceive(n);
  const source = prior.sources.find(s => s.id === sourceId);
  assert.deepEqual(source, waterSource(sourceId), 'The water identity and position come from real perception.');
  const connected = ['16,57', '16,58'].map(key => {
    const cell = current.cells.find(c => c.key === key);
    assert.ok(cell?.walkable);
    return { ...cell, visits: 0 };
  });
  const distractors = prior.cells.filter(c => c.x >= 1200 && c.x <= 1600 && c.y >= 5120 && c.y <= 5360)
    .map(c => ({ ...c, visits: 0 }));
  assert.equal(distractors.length, 24);
  assert.ok(distractors.every(c => c.walkable && canStand(c.x, c.y)));
  n.position = { ...actor };
  n.elapsed = 100;
  n.physiology.waterDeficitMl = 3600;
  n.flask.water = 0;
  // Synthetic retention of genuine observed records: this is not a natural
  // travel history or a claim that the entire river approach is remembered.
  n.memory.cells = Object.fromEntries([...connected, ...distractors].map(c => [c.key, c]));
  n.memory.sources = { [sourceId]: { ...source, observedAt: 90, confidence: 'observed', retryAfter: 0 } };
  assert.equal(bodySignals(n).thirst, 'desperate thirst');
  assert.ok(distance(actor, n.discovery.search.home) < DISCOVERY_RULES.searchRadius);
  assert.ok(distance(actor, source) > NPC_RULES.collectionRange);
  return { n, source, connected, distractors };
}

function rankedEndpoints(n, source) {
  return Object.values(n.memory.cells).filter(c => c.walkable && distance(c, n.position) > 45 && distance(c, n.position) < 900)
    .sort((a, b) => distance(a, source) - distance(b, source));
}

function assertWaterApproach(n) {
  const before = { rng: n.rng, cells: structuredClone(n.memory.cells), edges: structuredClone(n.memory.blockedEdges) };
  const decision = discoveryDecision(n);
  assert.deepEqual(decision, {
    action: waterAction,
    reason: 'I am approaching remembered water.',
    need: 'water',
    provider: 'discovery-learner',
  });
  assert.equal(n.rng, before.rng, 'Urgent care does not consume exploration RNG.');
  assert.deepEqual(n.memory.cells, before.cells, 'Route admission cannot fabricate observation records.');
  assert.deepEqual(n.memory.blockedEdges, before.edges, 'Search exclusions cannot become failure evidence.');
  return decision;
}

test('24 disconnected retained observations cannot hide the original real-river care approach', () => {
  const { n, source, connected, distractors } = riverFixture();
  assert.equal(routeLength(actor, routeFor(n, usefulEndpoint)), 80);
  for (let offset = 0; offset <= 80; offset++) assert.ok(canStand(actor.x, actor.y + offset));
  for (const cell of distractors) {
    assert.ok(distance(cell, source) < distance(usefulEndpoint, source));
    assert.ok(distance(cell, n.discovery.search.home) > DISCOVERY_RULES.searchRadius);
    assert.equal(routeFor(n, cell), null);
  }
  const ranked = rankedEndpoints(n, source);
  assert.equal(ranked.findIndex(c => c.key === tileKey(usefulEndpoint)), 24);
  assert.ok(ranked.slice(0, 24).every(c => distractors.some(d => d.key === c.key)));
  const clean = structuredClone(n);
  clean.memory.cells = Object.fromEntries(connected.map(c => [c.key, c]));
  assert.deepEqual(assertWaterApproach(n), assertWaterApproach(clean));
  const restored = validateNpc(JSON.parse(JSON.stringify(n)));
  assert.equal(Object.keys(restored.memory.cells).length, 26);
  assertWaterApproach(restored);
});

test('restored river care passes cognitive validation and completes a real time-and-effort move', () => {
  const { n } = riverFixture();
  const action = cognitiveAction(n, assertWaterApproach(n).action);
  assert.deepEqual(action, waterAction);
  const e = createEnvironment(25, { mode: 'discovery' });
  const before = { elapsed: n.elapsed, spent: n.physiology.totals.metabolizedKcal, water: n.flask.water };
  assert.equal(requestNpcAction(n, action, e).code, 'STARTED');
  for (let i = 0; i < 1200 && n.active; i++) tickNpc(n, 1 / 60, e);
  assert.equal(n.active, null);
  assert.equal(n.lastResult.code, 'ARRIVED');
  assert.ok(distance(n.position, usefulEndpoint) < 6);
  assert.ok(n.elapsed > before.elapsed);
  assert.ok(n.physiology.totals.metabolizedKcal > before.spent);
  assert.equal(n.flask.water, before.water, 'An approach is not a completed water collection.');
});

// Deliberately synthetic map fixtures isolate graph admission. The source and
// actor remain real; these cells are test inputs, not a physical route claim.
function detourFixture(kind) {
  const { n, source } = riverFixture();
  n.memory.cells = {};
  const add = (x, y) => {
    const point = { x: actor.x + x * NPC_RULES.tileSize, y: actor.y + y * NPC_RULES.tileSize };
    const cell = { ...point, key: tileKey(point), scene: 'valley', walkable: true, terrain: 'meadow', observedAt: 90, visits: 0 };
    n.memory.cells[cell.key] = cell;
    return cell;
  };
  add(0, 0);
  add(0, 1);
  const bend = kind === 'nominal' ? 12 : 6;
  const row = kind === 'nominal' ? 10 : 8;
  for (let x = 1; x <= bend; x++) add(x, 0);
  for (let y = 1; y <= row; y++) add(bend, y);
  for (let x = 5; x < bend; x++) add(x, row);
  const distractors = [];
  for (let y = 7; y <= 10; y++) for (let x = 0; x <= 5; x++) distractors.push(add(x, y));
  // Independent unweighted reachability witnesses the distinction between
  // connected endpoints and endpoints admissible for a single current action.
  const queue = [tileKey(actor)], depths = new Map([[queue[0], 0]]);
  for (const key of queue) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = `${x + dx},${y + dy}`;
      if (n.memory.cells[next]?.walkable && !depths.has(next)) {
        depths.set(next, depths.get(key) + 1);
        queue.push(next);
      }
    }
  }
  assert.equal(depths.size, Object.keys(n.memory.cells).length);
  assert.ok(distractors.every(c => distance(c, actor) < 900 && distance(c, source) < distance(usefulEndpoint, source)));
  assert.ok(rankedEndpoints(n, source).findIndex(c => c.key === tileKey(usefulEndpoint)) >= 24);
  assert.equal(routeLength(actor, routeFor(n, usefulEndpoint)), 80);
  return { n, source, distractors, depths };
}

test('connected endpoints beyond nominal route length cannot consume all 24 care slots', () => {
  const { n, distractors, depths } = detourFixture('nominal');
  for (const cell of distractors) {
    assert.ok(depths.get(cell.key) * NPC_RULES.tileSize > CONFIG.walkSpeed * NPC_RULES.maxActionSeconds);
    assert.equal(knownRoute(n.memory.cells, actor, cell, 1000), null, 'Nominal length still refuses even with the step cap relaxed.');
  }
  assertWaterApproach(n);
});

for (const slow of ['stamina', 'fatigue', 'energy', 'groggy', 'learned travel']) {
  test(`connected nominally valid endpoints cannot crowd care when ${slow} makes their routes too long`, () => {
    const { n, distractors } = detourFixture('body');
    if (slow === 'stamina') n.physiology.stamina = 5;
    if (slow === 'fatigue') n.physiology.fatigue = 90;
    if (slow === 'energy') n.energy = 5;
    if (slow === 'groggy') n.physiology.sleep.inertiaHours = 0.5;
    if (slow === 'learned travel') n.cognition.travel.secondsPerUnit = 1 / 50;
    const speed = slow === 'learned travel' ? 50 : CONFIG.walkSpeed * BIOLOGY_RULES.exhaustionWalkMultiplier;
    for (const cell of distractors) {
      const route = routeFor(n, cell);
      assert.ok(route, 'All 24 distractors pass the unchanged nominal route contract.');
      assert.ok(routeLength(actor, route) >= speed * (NPC_RULES.maxActionSeconds - 1));
    }
    assertWaterApproach(n);
  });
}

test('a connected and body-eligible closer endpoint still wins in the same detour fixture', () => {
  const { n, source } = detourFixture('body');
  const eligible = rankedEndpoints(n, source).filter(c => {
    const route = routeFor(n, c);
    return route && routeLength(actor, route) < CONFIG.walkSpeed * (NPC_RULES.maxActionSeconds - 1)
      && distance(c, source) < distance(actor, source) - 20;
  });
  assert.ok(eligible.length > 1);
  assert.notEqual(eligible[0].key, tileKey(usefulEndpoint));
  const decision = discoveryDecision(n);
  assert.equal(decision.need, 'water');
  assert.deepEqual(decision.action, { type: 'move', target: { x: eligible[0].x, y: eligible[0].y } });
});

test('remembered water never supplies an unobserved route, bridge or wrong-scene map', () => {
  for (const mode of ['empty', 'disconnected', 'blocked', 'wrong scene']) {
    const { n, distractors } = riverFixture();
    if (mode === 'empty') n.memory.cells = {};
    if (mode === 'disconnected') n.memory.cells = Object.fromEntries(distractors.map(c => [c.key, c]));
    if (mode === 'blocked') n.memory.blockedEdges['16,57>16,58'] = { retryAfter: n.elapsed + 60 };
    if (mode === 'wrong scene') {
      n.scene = 'refuge';
      n.memory.caveCells = { refuge: {} };
      n.memory.caveExits = { refuge: { ...usefulEndpoint } };
    }
    const cells = structuredClone(n.memory.cells), edges = structuredClone(n.memory.blockedEdges);
    assert.notEqual(discoveryDecision(n).action.type, 'move', mode);
    assert.deepEqual(n.memory.cells, cells);
    assert.deepEqual(n.memory.blockedEdges, edges);
    if (mode === 'empty' || mode === 'wrong scene') assert.equal(cognitiveAction(n, waterAction), null);
  }
});

test('the learned-speed action bound stays strict at equality and is reread on every decision', () => {
  const { n, connected } = riverFixture();
  n.memory.cells = Object.fromEntries(connected.map(c => [c.key, c]));
  const exactCost = (NPC_RULES.maxActionSeconds - 1) / 80;
  n.cognition.travel.secondsPerUnit = exactCost;
  assert.equal((1 / exactCost) * (NPC_RULES.maxActionSeconds - 1), 80);
  assert.notEqual(discoveryDecision(n).action.type, 'move', 'An exactly 11-second approach is excluded.');
  n.cognition.travel.secondsPerUnit = exactCost + 1e-12;
  assert.notEqual(discoveryDecision(n).action.type, 'move');
  n.cognition.travel.secondsPerUnit = exactCost - 1e-12;
  assertWaterApproach(n);
  n.memory.blockedEdges['16,57>16,58'] = { retryAfter: n.elapsed + 1 };
  assert.notEqual(discoveryDecision(n).action.type, 'move', 'A new actual failed-edge record invalidates the next search.');
  n.elapsed += 1;
  assertWaterApproach(n);
  assert.ok(n.memory.blockedEdges['16,57>16,58'], 'Expiry does not erase retained failure evidence.');
});

let learned;
function tick(f) {
  tickEnvironment(f.e, 1 / 60);
  tickEcology(f.e.ecology, 1 / 60, f.e, [f.n]);
  tickNpc(f.n, 1 / 60, f.e);
  processDiscoveryFeedback(f.n, { recordEffect: effect => recordEvent(f.n, 'condition', { code: 'DISCOVERY_EFFECT', feedback: effect }) });
}
function act(f, action) {
  const started = requestNpcAction(f.n, action, f.e);
  for (let i = 0; i < 1200 && f.n.active; i++) tick(f);
  assert.equal(f.n.active, null);
  return f.n.lastResult || started;
}
function positiveCount(f) {
  return new Set(f.n.discovery.effects.filter(e => e.objectId === f.id && e.effect === 'sustained').map(e => e.ingestionId)).size;
}
function foodFixture() {
  if (!learned) {
    const n = createNpc({ mode: 'discovery', seed: 74193 });
    const e = createEnvironment(74193, { mode: 'discovery' });
    const plant = e.ecology.plants.find(p => p.kind === 'apple_tree' && p.quantity > 0);
    n.position = [{ x: plant.position.x + 45, y: plant.position.y }, { x: plant.position.x - 45, y: plant.position.y }]
      .find(p => canStand(p.x, p.y));
    assert.ok(n.position);
    n.physiology.hoursSinceMeal = 20;n.physiology.satietyHours=Math.max(0,6-20);
    projectPhysiology(n);
    observeNpc(n, e);
    const f = { n, e, plant };
    assert.equal(act(f, { type: 'pull', targetId: plant.id }).ok, true);
    f.id = n.inventory.items[0];
    for (let count = 1; count <= 2; count++) {
      assert.equal(act(f, { type: 'sample', targetId: f.id }).ok, true);
      for (let i = 0; i < 24000 && positiveCount(f) < count; i++) tick(f);
      assert.equal(positiveCount(f), count);
    }
    learned = f;
  }
  const f = structuredClone(learned);
  // A body checkpoint isolates urgent care. Every food association and item
  // above was earned by actual acquisition, swallowing and delayed feedback.
  f.n.physiology.hoursSinceMeal = 20;f.n.physiology.satietyHours=Math.max(0,6-20);
  f.n.physiology.waterDeficitMl = 250;
  projectPhysiology(f.n);
  assert.ok(['ravenous', 'faint with hunger'].includes(bodySignals(f.n).hunger));
  return f;
}

function thermalFixture() {
  const f = foodFixture(), refuge = shelterSource('refuge');
  f.n.position = { x: refuge.x, y: refuge.y };
  observeNpc(f.n, f.e);
  f.n.thermal.hot = 80;
  return { ...f, refuge };
}

test('care priority remains water before observed thermal refuge before earned held food', () => {
  const f = thermalFixture(), thirsty = structuredClone(f);
  thirsty.n.physiology.waterDeficitMl = 3600;
  thirsty.n.flask.water = 1;
  let decision = discoveryDecision(thirsty.n);
  assert.equal(decision.need, 'water');
  assert.deepEqual(decision.action, { type: 'drink' });
  assert.equal(act(thirsty, decision.action).code, 'DRANK');
  decision = discoveryDecision(f.n);
  assert.equal(decision.need, 'thermal');
  assert.deepEqual(decision.action, { type: 'enter_shelter', shelterId: f.refuge.id });
  const calm = structuredClone(f.n);
  assert.equal(act(f, decision.action).code, 'ENTERED_SHELTER');
  calm.thermal.hot = 0;
  decision = discoveryDecision(calm);
  assert.equal(decision.need, 'food');
  assert.deepEqual(decision.action, { type: 'sample', targetId: f.id });
});

test('actual painful contact preempts simultaneous water, thermal and earned food opportunities', () => {
  const f = thermalFixture(), predator = f.e.ecology.animals.find(a => a.species === 'bobcat');
  f.n.thermal.hot = 0;
  const near = [{ x: f.n.position.x + 18, y: f.n.position.y }, { x: f.n.position.x - 18, y: f.n.position.y }, { x: f.n.position.x, y: f.n.position.y + 18 }]
    .find(p => canStand(p.x, p.y));
  assert.ok(near);
  // Controlled real contact, not a naturally reached ecological encounter.
  predator.position = { ...near };
  Object.assign(predator.physiology, { availableEnergyKcal: 10, storedEnergyKcal: 0, waterDeficitMl: 0, hoursSinceMeal: 12 });
  projectPhysiology(predator);
  f.e.ecology.animals = [predator];
  f.e.ecology.plants = [];
  observeNpc(f.n, f.e);
  const state = freshState({ mode: 'legacy' });
  Object.assign(state, { simulationMode: 'discovery', environment: f.e, agents: [f.n], npc: f.n, elapsed: f.n.elapsed, cardinal: null });
  const runtime = new PopulationRuntime(state, { cardinal: false });
  try {
    for (let i = 0; i < 240 && !f.n.memory.experience.some(e => e.details?.code === 'CONTACT_INJURY'); i++) {
      state.elapsed += 1 / 60;
      runtime.tick(1 / 60);
    }
  } finally { runtime.dispose(); }
  const injury = f.n.memory.experience.find(e => e.details?.code === 'CONTACT_INJURY');
  assert.equal(injury?.details.provenance, 'experienced contact');
  cancelNpcAction(f.n);
  f.n.physiology.waterDeficitMl = 3600;
  f.n.flask.water = 1;
  f.n.thermal.hot = 80;
  assert.equal(positiveCount(f), 2);
  assert.ok(f.n.memory.shelters[f.refuge.id]);
  const withoutContact = structuredClone(f.n);
  withoutContact.memory.experience = withoutContact.memory.experience.filter(e => e.details?.code !== 'CONTACT_INJURY');
  assert.equal(discoveryDecision(withoutContact).need, 'water');
  withoutContact.physiology.waterDeficitMl = 250;
  assert.equal(discoveryDecision(withoutContact).need, 'thermal');
  withoutContact.thermal.hot = 0;
  assert.equal(discoveryDecision(withoutContact).need, 'food');
  const decision = discoveryDecision(f.n);
  assert.equal(decision.need, 'safety');
  assert.equal(decision.action.type, 'move');
  assert.ok(routeFor(f.n, decision.action.target));
});

test('route admission preserves sensed fullness and authoritative swallowing refusal across held items', () => {
  const full = foodFixture();
  assert.equal(ingestMaterial(full.n, { massGrams: 800, energyKcal: 0, waterMl: 0, digestHours: 24 }, { provenance: 'explicit fullness fixture' }).ok, true);
  assert.ok(['full', 'overfull'].includes(bodySignals(full.n).digestion));
  assert.notEqual(discoveryDecision(full.n).action.type, 'sample');

  const f = foodFixture();
  assert.equal(act(f, { type: 'pull', targetId: f.plant.id }).ok, true);
  assert.ok(f.n.inventory.items.some(id => id !== f.id));
  while (f.n.physiology.stomach.length < 24) {
    assert.equal(ingestMaterial(f.n, { massGrams: 1, energyKcal: 0, waterMl: 0, digestHours: 24 }, { provenance: 'explicit entry-count fixture' }).ok, true);
  }
  assert.equal(bodySignals(f.n).digestion, 'settled');
  assert.deepEqual(discoveryDecision(f.n).action, { type: 'sample', targetId: f.id });
  const material = lookupEcologyObject(f.e.ecology, f.id), before = material.massGrams;
  assert.equal(act(f, { type: 'sample', targetId: f.id }).code, 'TOO_FULL');
  assert.equal(material.massGrams, before);
  for (let i = 0; i < 8; i++) assert.notEqual(discoveryDecision(f.n).action.type, 'sample');
  assert.notEqual(discoveryDecision(validateNpc(JSON.parse(JSON.stringify(f.n)))).action.type, 'sample');
});

test('pending evidence stays item-specific and foodLearning:false keeps ordinary cautious waiting', () => {
  const f = foodFixture();
  assert.equal(act(f, { type: 'sample', targetId: f.id }).ok, true);
  const pending = f.n.discovery.samplesPending[f.id];
  assert.deepEqual(discoveryDecision(f.n).action, { type: 'sample', targetId: f.id }, 'Two independently earned portions allow supported same-item reuse.');
  assert.equal(f.n.discovery.samplesPending[f.id], pending);
  const ablated = structuredClone(f.n), techniques = structuredClone(f.n.discovery.techniques);
  const decision = discoveryDecision(ablated, { foodLearning: false });
  assert.notEqual(decision.need, 'food');
  assert.notDeepEqual(decision.action, { type: 'sample', targetId: f.id });
  assert.equal(ablated.discovery.run, null);
  assert.deepEqual(ablated.discovery.techniques, techniques);
  assert.equal(ablated.discovery.samplesPending[f.id], pending);

  assert.equal(act(f, { type: 'pull', targetId: f.plant.id }).ok, true);
  const fresh = f.n.inventory.items.find(id => id !== f.id);
  assert.ok(fresh);
  assert.equal(act(f, { type: 'sample', targetId: fresh }).ok, true);
  assert.equal(f.n.discovery.effects.some(e => e.objectId === fresh), false);
  for (let i = 0; i < 8; i++) assert.notDeepEqual(discoveryDecision(f.n).action, { type: 'sample', targetId: fresh });
  assert.ok(f.n.discovery.samplesPending[fresh] !== undefined);
});

test('actual delayed discomfort still excludes the exact item despite supported food experience', () => {
  const f = foodFixture(), material = lookupEcologyObject(f.e.ecology, f.id);
  material.ageHours = 12 * 24;
  material.spoiled = true; // Controlled surprise uses unchanged real spoil chemistry.
  assert.equal(act(f, { type: 'sample', targetId: f.id }).ok, true);
  for (let i = 0; i < 24000 && !f.n.discovery.effects.some(e => e.objectId === f.id && e.effect === 'discomfort'); i++) tick(f);
  assert.ok(f.n.discovery.effects.some(e => e.objectId === f.id && e.effect === 'discomfort'));
  assert.ok(positiveCount(f) >= 2);
  assert.equal(f.n.discovery.techniques.find(t => t.sourceId === f.plant.id).confidence, 'revised');
  for (const enabled of [true, false]) {
    const restored = validateNpc(JSON.parse(JSON.stringify(f.n)));
    for (let i = 0; i < 8; i++) assert.notDeepEqual(discoveryDecision(restored, { foodLearning: enabled }).action, { type: 'sample', targetId: f.id });
  }
});
