// Deterministic copied native-action fixture, not an autonomous world trial.
// Food proof is never seeded: every acquisition, sample, and recognition below
// is earned by the actual request/tick/completion/physiology path.
import assert from 'node:assert/strict';
import { createOzarkState } from '../../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../../src/ozark-agent-world.js';
import { bindOzarkEcology } from '../../src/ozark-ecology.js';
import { observeNpc } from '../../src/npc.js';
import { bodySignals } from '../../src/interoception.js';
import { projectPhysiology } from '../../src/biology.js';
import { retainedProofIntegrityError } from '../../src/proof-retention.js';
import { ownHandReplayView } from '../../src/own-hand-memory.js';
import { geometry, tick, act, place, comfortableHungry as baseComfortableHungry, pendingIdentity } from './capacity-preparation.mjs';

function comfortableHungry(n) {
  baseComfortableHungry(n);
  n.physiology.hoursSinceMeal = 6;
  projectPhysiology(n);
}

function sourcePending(n, sourceId) {
  return n.discovery.experiments.some(e => e.materialId && e.targetId === sourceId &&
    n.discovery.samplesPending[e.materialId] !== undefined &&
    n.elapsed - n.discovery.samplesPending[e.materialId] < 45);
}

function waitForOwnSustained(f, sample) {
  const matches = e => e.effect === 'sustained' && e.actionId === sample.eventId &&
    e.ingestionId === sample.ingestionId;
  for (let i = 0; i < 1200 && !f.n.discovery.effects.some(matches); i++) tick(f);
  const effect = f.n.discovery.effects.find(matches);
  assert.ok(effect, 'the actual swallowed portion earns its own delayed relief');
  return effect;
}

function bind(state) {
  bindOzarkEcology(state.environment.ecology, geometry);
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  return { state, n: state.agents[0], e: state.environment,
    source: state.environment.ecology.plants.find(p => p.id === 'object:683'), chains: [] };
}

function addHandledPending(f, count) {
  const grass = f.e.ecology.plants.find(p => p.id === 'object:670');
  place(f, { x: grass.position.x + 20, y: grass.position.y });
  for (let i = 0; i < count; i++) {
    assert.equal(act(f, { type: 'pull', targetId: grass.id }).ok, true);
    const id = f.n.inventory.items.at(-1);
    assert.equal(act(f, { type: 'release', targetId: id }).ok, true);
    assert.equal(act(f, { type: 'grasp', targetId: id }).ok, true);
    assert.equal(act(f, { type: 'sample', targetId: id }).ok, true);
    assert.ok(f.n.inventory.items.includes(id));
  }
  place(f, { x: f.source.position.x + 20, y: f.source.position.y });
}

const cached = new Map();
function fixture({ returns = 2, fullHands = false } = {}) {
  const key = `${returns}:${fullHands}`;
  if (!cached.has(key)) {
    const seed = bind(createOzarkState(geometry));
    place(seed, { x: seed.source.position.x + 20, y: seed.source.position.y });
    comfortableHungry(seed.n);
    for (let i = 0; i < returns; i++) {
      const acquisition = act(seed, { type: 'pull', targetId: seed.source.id });
      assert.equal(acquisition.ok, true);
      const materialId = acquisition.materialId;
      const sample = act(seed, { type: 'sample', targetId: materialId });
      assert.equal(sample.ok, true);
      const effect = waitForOwnSustained(seed, sample);
      seed.chains.push({ acquisition, materialId, sample, effect });
    }
    if (fullHands) addHandledPending(seed, 4 - returns);
    // Copy before either final remainder. No negative own-hand runtime state
    // exists yet; copies earn those tokens through new native completions below.
    assert.equal(seed.n.inventory.items.length, fullHands ? 4 : returns);
    cached.set(key, structuredClone({ state: seed.state, chains: seed.chains }));
  }
  const saved = structuredClone(cached.get(key)), f = bind(saved.state);
  f.chains = saved.chains;
  observeNpc(f.n, f.e);
  for (const chain of f.chains) {
    const { materialId } = chain;
    const remainder = act(f, { type: 'sample', targetId: materialId });
    assert.equal(remainder.ok, true);
    assert.equal(f.n.inventory.items.includes(materialId), false);
    assert.equal(ownHandReplayView(f.n).suspended.has(materialId), true);
    chain.remainder = remainder;
  }
  if (fullHands) addHandledPending(f, returns);
  comfortableHungry(f.n);
  observeNpc(f.n, f.e);
  f.technique = f.n.discovery.techniques.find(t => t.sourceId === f.source.id);
  assert.ok(f.technique);
  assert.equal(f.n.inventory.items.length, fullHands ? 4 : 0);
  assert.equal(sourcePending(f.n, f.source.id), true);
  assert.equal(bodySignals(f.n).hunger, 'peckish');
  assert.equal(bodySignals(f.n).thirst, 'quenched');
  assert.equal(bodySignals(f.n).overall, 'settled');
  assert.equal(retainedProofIntegrityError(f.n), null);
  return f;
}

export { geometry, fixture, tick, act, place, comfortableHungry, pendingIdentity,
  sourcePending, waitForOwnSustained };
