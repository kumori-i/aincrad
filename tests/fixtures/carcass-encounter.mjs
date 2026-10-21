/** Fixed local-exposure measurement and separately disclosed synthetic save
 * fixtures. None is evidence of a learned hunt or a route from normal spawn. */
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { createOzarkWorldGeometry } from '../../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave,
  OZARK_SAVE_KEY } from '../../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../../src/npc.js';
import { tickEnvironment } from '../../src/environment.js';
import { processDiscoveryFeedback } from '../../src/discovery.js';
import { ecologyEnergy, lookupEcologyObject } from '../../src/ecology.js';

export const ENCOUNTER_PROTOCOL = Object.freeze({
  kind: 'h1-fixed-carcass-encounters-v1', seed: 74193, seconds: 600,
  stepSeconds: CONFIG.fixedStep, exposureRadius: 75, exposureAngles: 32,
  selection: 'Initially full-health rabbit nearest ordinary Aster spawn; numeric object ID breaks ties.',
  exposure: 'One placement of fresh Aster at the first dry-ground LOS point, starting at the bearing from rabbit toward ordinary spawn and adding 2*pi*i/32. Rabbit, other actors, body stocks and world remain untouched. No valid point means blocked; no alternate prey.',
  commanded: 'External test driver consumes only public decisionObservation. Inspect the designated observed ID once, then strike if its last observed location is within 80px. Otherwise try the locally observed walkable tile minimizing distance to that observed location, then actor distance, x, y; require at least 1px target-distance progress and >6px actor travel. Exclude tiles with a failed move receipt in the previous 10 seconds. After exact successful terminal-strike resultObjectId, use only that observed successor, pull once successfully, then sample the acquired held material once successfully. Never retarget another animal or infer a successor by proximity. If an object is unavailable, no eligible tile exists, or the exact chain is complete, issue no action and continue observing at 1-second cadence. Commands are subject to ordinary native admission, costs, capacity and completion checks.',
  autonomous: 'Independent fresh identical exposure, both ordinary unchanged local controllers. No testimony, preloaded knowledge, supplied sequence, priority changes or hidden labels.',
  clock: 'PopulationRuntime owns shared ecology/environment and both actor ticks exactly once per fixed step; commanded row replaces only Aster controller with tickNpc, native observation/feedback and requestNpcAction. Mira remains ordinary. Stop at 600 simulated seconds or Aster collapse, before rescue; keep all negative results.',
  success: 'Retain the first exact terminal-strike -> carcass pull -> acquired-piece sample. Thereafter observe only through fixed endpoint in commanded row. Autonomous behavior remains unchanged throughout.',
  prohibitions: ['no seed or target search', 'no power override', 'no direct damage',
    'no post-exposure teleport', 'no frozen prey or ecology', 'no rescue',
    'no physiology or movement tuning', 'no hidden-health command decisions',
    'no extra food or stock', 'no horizon extension'],
  attribution: 'Exact action/experiment/resultObjectId/materialId/ingestionId chain only. Retain references to digestive portions across each native tick so their final absorption counters are recorded even when removed from the stomach. Other food and scavenged carcasses are separate. No whole-animal mass/water conservation, net profit, robust access, renewability or survival claim.',
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const idNumber = row => Number(row.id.slice(7));

export function createCarcassEncounterFixture() {
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  assert.equal(state.environment.seed, ENCOUNTER_PROTOCOL.seed);
  const actor = state.agents.find(row => row.id === 'aster');
  const normalSpawn = { ...actor.position };
  const prey = state.environment.ecology.animals.filter(row =>
    row.species === 'rabbit' && row.health === 100 &&
    row.physiology.health === 100).sort((a, b) =>
    distance(a.position, normalSpawn) - distance(b.position, normalSpawn) ||
    idNumber(a) - idNumber(b))[0];
  assert.ok(prey, 'Fixed fresh ecology has an initially full-health rabbit');
  const bearing = Math.atan2(normalSpawn.y - prey.position.y,
    normalSpawn.x - prey.position.x), attempts = [];
  let exposure = null;
  for (let i = 0; i < ENCOUNTER_PROTOCOL.exposureAngles; i++) {
    const angle = bearing + 2 * Math.PI * i / ENCOUNTER_PROTOCOL.exposureAngles;
    const position = { x: prey.position.x + Math.cos(angle) * 75,
      y: prey.position.y + Math.sin(angle) * 75 };
    const dry = geometry.classify(position.x, position.y,
      CONFIG.playerRadius).reason === 'dry-ground';
    const lineOfSight = geometry.lineOfSight(position, prey.position);
    attempts.push({ index: i, position, dry, lineOfSight });
    if (dry && lineOfSight) { exposure = position; break; }
  }
  const fixture = { seed: ENCOUNTER_PROTOCOL.seed, targetId: prey.id,
    initialPreyPosition: { ...prey.position }, initialHealth: prey.physiology.health,
    normalSpawn, exposure, attempts, reachableFromSpawnClaimed: false,
    saveFixture: false, limitation: 'Remote local exposure at time zero, not a reachable-from-spawn or saveable encounter.' };
  if (!exposure) return { state, geometry, actor, fixture, blocked: true };
  actor.position = { ...exposure };
  for (const npc of state.agents) {
    assert.equal(npc.seed, 74193);
    assert.equal(npc.rng, 74193);
    assert.equal(npc.memory.experience.length, 0);
    assert.equal(npc.discovery.experiments.length, 0);
    assert.equal(npc.discovery.techniques.length, 0);
    bindOzarkWorldAgent(npc, geometry, state);
  }
  return { state, geometry, actor, fixture, blocked: false };
}

/** Disclosed synthetic current persistence input, deliberately NOT the encounter.
 * Keep actors at ordinary spawns, relocate one existing rabbit to a valid local
 * point, and set its health to 7. Stocks and the energy ledger are unchanged.
 * During this tiny fixture preparation only, environment/body time advances
 * but ecology is held static; all timed handling uses the native action API.
 * It demonstrates disk persistence of actual receipts, never hunting ability. */
export function createCarcassDiskFixture(stage) {
  assert.ok(['relation', 'pulled', 'processing'].includes(stage));
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const actor = state.agents[0], ecology = state.environment.ecology;
  const prey = ecology.animals.find(row => row.species === 'rabbit');
  const initialEnergy = ecologyEnergy(ecology), initialNextId = ecology.nextId;
  const originalPosition = { ...prey.position };
  const position = Array.from({ length: 32 }, (_, i) => ({
    x: actor.position.x + Math.cos(2 * Math.PI * i / 32) * 60,
    y: actor.position.y + Math.sin(2 * Math.PI * i / 32) * 60,
  })).find(point => geometry.classify(point.x, point.y, 7).reason === 'dry-ground' &&
    geometry.lineOfSight(actor.position, point));
  assert.ok(position, 'Synthetic spawn-near prey placement exists');
  prey.position = { ...position }; prey.homePosition = { ...position };
  prey.health = prey.physiology.health = 7;
  assert.equal(ecologyEnergy(ecology), initialEnergy);
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  const advance = () => {
    state.elapsed += CONFIG.fixedStep;
    tickEnvironment(state.environment, CONFIG.fixedStep);
    ecology.elapsed = state.environment.elapsed;
    for (const npc of state.agents) {
      tickNpc(npc, CONFIG.fixedStep, state.environment);
      processDiscoveryFeedback(npc);
    }
  };
  const finish = action => {
    const admitted = requestNpcAction(actor, action, state.environment);
    assert.equal(admitted.code, 'ACTION_STARTED', JSON.stringify(admitted));
    for (let step = 0; actor.active && step < 1200; step++) advance();
    assert.equal(actor.active, null, 'Synthetic timed action completes');
    assert.equal(actor.lastResult?.ok, true, JSON.stringify(actor.lastResult));
    return actor.memory.experience.filter(row => row.type === 'action').at(-1);
  };
  observeNpc(actor, state.environment);
  const strike = finish({ type: 'strike', targetId: prey.id });
  const carcassId = strike.details.result.resultObjectId;
  assert.equal(strike.details.result.code, 'object_stopped_moving');
  assert.ok(carcassId && lookupEcologyObject(ecology, carcassId)?.kind === 'carcass');
  assert.equal(actor.inventory.items.length, 0);
  const experiment = actor.discovery.experiments.find(row => row.actionId === strike.id);
  assert.equal(experiment?.resultObjectId, carcassId);
  let pull = null, activeBeforeWrite = null;
  if (stage === 'pulled') pull = finish({ type: 'pull', targetId: carcassId });
  if (stage === 'processing') {
    assert.equal(requestNpcAction(actor, { type: 'pull', targetId: carcassId },
      state.environment).code, 'ACTION_STARTED');
    for (let i = 0; i < Math.round(.5 / CONFIG.fixedStep); i++) advance();
    assert.ok(actor.active?.worked > 0 && actor.active.worked < actor.active.seconds);
    activeBeforeWrite = structuredClone(actor.active);
  }
  // Native validation must accept the current geometry/reach/proof gate.
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  const written = writeOzarkSave(storage, state, geometry);
  if (!written) {
    const { npc: _alias, ...disk } = state;
    const diagnostic = loadOzarkSave({ getItem: key => key === OZARK_SAVE_KEY ?
      JSON.stringify(disk) : null }, geometry);
    assert.fail(diagnostic.error || 'Synthetic write failed its native validator');
  }
  const raw = values.get(OZARK_SAVE_KEY), reopened = loadOzarkSave(storage, geometry);
  assert.equal(reopened.blocked, false, reopened.error);
  return { stage, raw, expectedRestored: JSON.parse(JSON.stringify(reopened.state)),
    targetId: prey.id, carcassId, materialId: pull?.details.result.materialId ?? null,
    strike, experiment, pull, activeBeforeWrite, initialNextId,
    fixture: { synthetic: true, realTimedPowerOneActions: true,
      rabbitHealthSetToSeven: true, rabbitOriginalPosition: originalPosition,
      rabbitFixturePosition: position, actorPositionsUnchanged: true,
      stockOrEnergyAdded: false, initialEnergy, ecologyHeldStaticDuringPreparation: true,
      environmentAndBodyClockAdvanced: true,
      huntingFeasibilityClaimed: false, normalReachAndSaveValidatorsUnmodified: true } };
}
