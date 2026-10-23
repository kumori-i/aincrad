/** Pure evidence projection, also serialized into the disposable native runner.
 * Keep it independent of module scope and imports. */
export function structuralMovementEvidence(state) {
  return structuredClone({
    player: state.player, playerBody: state.playerBody,
    elapsed: state.elapsed, distance: state.distance,
    clocks: { environmentElapsed: state.environment.elapsed,
      ecologyElapsed: state.environment.ecology.elapsed,
      ecologyPending: state.environment.ecology.pending },
    agents: state.agents.map(actor => ({
      id: actor.id, position: actor.position, elapsed: actor.elapsed,
      active: actor.active ?? null, memory: actor.memory,
      discovery: actor.discovery, physiology: actor.physiology,
    })),
  });
}

/** Browser-compatible fixture, not a replay of autonomous learning or travel.
 * Only initial Aster/player placement is synthetic. Every observation, paid
 * movement outcome, physiology change and clock increment uses normal APIs. */
export async function createStructuralMovementFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } =
    await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback } = await use('discovery');
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  // Deliberately duplicated so Function(createStructuralMovementFixture.toString())
  // has no closure dependency. Tests compare this to the exported projection.
  function structuralMovementEvidence(state) {
    return structuredClone({
      player: state.player, playerBody: state.playerBody,
      elapsed: state.elapsed, distance: state.distance,
      clocks: { environmentElapsed: state.environment.elapsed,
        ecologyElapsed: state.environment.ecology.elapsed,
        ecologyPending: state.environment.ecology.pending },
      agents: state.agents.map(actor => ({
        id: actor.id, position: actor.position, elapsed: actor.elapsed,
        active: actor.active ?? null, memory: actor.memory,
        discovery: actor.discovery, physiology: actor.physiology,
      })),
    });
  }
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const environment = state.environment, ecology = environment.ecology;
  const actor = state.agents.find(row => row.id === 'aster');
  const oldCoordinate = { x: 527.9482587463335, y: 3120.0000031694867 };
  require(geometry.canOccupy(oldCoordinate.x, oldCoordinate.y, CONFIG.playerRadius),
    'The exact historical coordinate must remain physically occupiable');
  state.player = { ...oldCoordinate };
  actor.position = { ...oldCoordinate };
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  const initialPhysiology = state.agents.map(npc => ({
    id: npc.id, physiology: structuredClone(npc.physiology),
  }));
  function advance(seconds) {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += CONFIG.fixedStep) {
      const dt = Math.min(CONFIG.fixedStep, seconds - elapsed);
      tickEnvironment(environment, dt);
      tickOzarkEcology(ecology, dt, environment, state.agents, {}, geometry);
      for (const npc of state.agents) {
        tickNpc(npc, dt, environment);
        processDiscoveryFeedback(npc);
      }
      state.elapsed = environment.elapsed;
    }
  }
  // Normal ticks, not a clock assignment: observations at the remote synthetic
  // placement must fit the current codec's conservative spawn-time reach bound.
  // There is no claim that an agent actually travelled from its original spawn.
  const preparationSeconds = 16;
  advance(preparationSeconds);
  const failedRequest = { type: 'move', target: { x: 560, y: 3120 } };
  const observation = observeNpc(actor, environment);
  require(observation.cells.some(cell => cell.x === failedRequest.target.x &&
    cell.y === failedRequest.target.y && cell.walkable),
  'The blocked target must be genuinely observed before requesting movement');
  const failureBefore = { at: actor.elapsed, position: { ...actor.position },
    physiology: structuredClone(actor.physiology) };
  const failedAdmission = requestNpcAction(actor, failedRequest, environment);
  require(failedAdmission.code === 'STARTED',
    'Blocked movement admission failed: ' + JSON.stringify(failedAdmission));
  const failedRoute = structuredClone(actor.active.route);
  let failedSteps = 0;
  while (actor.active && failedSteps < 120) {
    advance(CONFIG.fixedStep);
    failedSteps++;
  }
  require(!actor.active && actor.lastResult?.code === 'ROUTE_BLOCKED' &&
    actor.lastResult.ok === false, 'The paid blocked movement must terminate in failure');
  const failedReceipt = structuredClone(actor.memory.experience.find(event =>
    event.type === 'action' && event.details.result.code === 'ROUTE_BLOCKED'));
  require(failedReceipt?.details.result.durationSeconds > 0,
    'The failure must have a real paid action receipt');
  const failureAfter = { at: actor.elapsed, position: { ...actor.position },
    physiology: structuredClone(actor.physiology) };
  require(failureAfter.physiology.totals.metabolizedKcal >
    failureBefore.physiology.totals.metabolizedKcal,
  'The failed movement must consume real metabolism');
  // Preserve the real microunit Y displacement from the resisted attempt.
  // In particular, do not repair Aster back to the original player coordinate.
  const pendingRequest = { type: 'move', target: { x: 480, y: 3120 } };
  const pendingObservation = observeNpc(actor, environment);
  require(pendingObservation.cells.some(cell => cell.x === pendingRequest.target.x &&
    cell.y === pendingRequest.target.y && cell.walkable),
  'The unfinished target must be genuinely observed');
  const pendingBefore = { at: actor.elapsed, position: { ...actor.position },
    physiology: structuredClone(actor.physiology) };
  const pendingAdmission = requestNpcAction(actor, pendingRequest, environment);
  require(pendingAdmission.code === 'STARTED',
    'Unfinished movement admission failed: ' + JSON.stringify(pendingAdmission));
  advance(CONFIG.fixedStep);
  require(actor.active?.request.type === 'move',
    'The restart fixture must save a still-active movement, not a completion');
  const partialPaidSeconds = actor.elapsed - actor.active.startedAt;
  require(partialPaidSeconds > 0 && actor.active.attemptedDistance > 0 &&
    actor.physiology.totals.metabolizedKcal > pendingBefore.physiology.totals.metabolizedKcal,
  'The unfinished move must have already paid time, attempted effort and metabolism');
  require(actor.memory.experience.filter(event => event.type === 'action').length === 1,
    'Only the actual failed movement may have completed before saving');
  const pendingActive = structuredClone(actor.active);
  const rows = new Map(), storage = {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
  };
  require(writeOzarkSave(storage, state, geometry) === true && rows.has(OZARK_SAVE_KEY),
    'Fixture failed strict current-save validation');
  const raw = rows.get(OZARK_SAVE_KEY);
  const loaded = loadOzarkSave(storage, geometry);
  require(loaded.exists && !loaded.blocked && loaded.state,
    'Fixture failed real current-save restoration: ' + loaded.error);
  const expectedRestored = structuralMovementEvidence(loaded.state);
  return { saveKey: OZARK_SAVE_KEY, raw, expectedRestored, summary: {
    version: state.version, features: { ...state.features }, elapsed: state.elapsed, oldCoordinate,
    preparationSeconds, failedRequest, failedAdmission, failedRoute,
    failedSteps, failedReceipt, failureBefore, failureAfter,
    pendingActorId: actor.id, pendingRequest, pendingAdmission, pendingBefore,
    pendingActive, partialPaidSeconds, sourcePosition: { ...actor.position },
    initialPhysiology,
    clock: { elapsed: state.elapsed, environmentElapsed: environment.elapsed,
      ecologyElapsed: ecology.elapsed, ecologyPending: ecology.pending,
      agents: state.agents.map(npc => ({ id: npc.id, elapsed: npc.elapsed })) },
    fixtureDisclosure: 'Synthetic initial placement of Aster and the player at the exact historical legal coordinate. Both bodies, finite ecology and the environment advance through ordinary fixed ticks; only observations and external test-driver movement requests are supplied. The failed movement and its microunit displacement are genuine. A second observed move pays one fixed step and remains unfinished at save. No clock or physiology injection, fabricated receipt, supplied skill, learned recovery, autonomous route or survival claim. The player stays at the exact old coordinate for a separate real player-engine retreat test.',
  } };
}
