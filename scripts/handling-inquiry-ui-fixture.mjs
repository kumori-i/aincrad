/** Explicit encounter placement for native UI QA, not autonomous travel or
 * survival evidence. Each exported function is self-contained for serialization
 * into the existing sandboxed current-world harness. No fabricated receipts,
 * hidden policy evidence, Node access, or second application route. */
export async function createHandlingInquiryUiFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback, freshMethodAppearance } = await use('discovery');
  const { handlingInquiries } = await use('handling-inquiry');
  const { appearanceCuesMatch } = await use('peer-teaching');
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const environment = state.environment, actor = state.agents[0];
  for (const n of state.agents) bindOzarkWorldAgent(n, geometry, state);
  function advance(seconds) {
    for (let passed = 0; passed < seconds - 1e-9; passed += .25) {
      const dt = Math.min(.25, seconds - passed);
      tickEnvironment(environment, dt);
      tickOzarkEcology(environment.ecology, dt, environment, state.agents, {}, geometry);
      for (const n of state.agents) { tickNpc(n, dt, environment); processDiscoveryFeedback(n); }
      state.elapsed = environment.elapsed;
    }
  }
  advance(60);
  // Selecting an encounter is a disclosed fixture operation, not a policy
  // oracle. Only fresh sensory descriptors reach the ordinary learner.
  const plants = environment.ecology.plants.filter(p => p.kind === 'apple_tree' && p.quantity > 2);
  let source, target, sourcePoint, targetPoint;
  search: for (const a of plants) for (const b of plants) {
    const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    const p = { x: a.position.x + 45, y: a.position.y }, q = { x: b.position.x + 45, y: b.position.y };
    if (distance <= 120 || distance >= 260 || ![p, q].every(point => geometry.canOccupy(point.x, point.y, CONFIG.playerRadius)) ||
      !geometry.lineOfSight(p, a.position) || !geometry.lineOfSight(q, a.position) || !geometry.lineOfSight(q, b.position)) continue;
    source = a; target = b; sourcePoint = p; targetPoint = q; break search;
  }
  if (!source) throw new Error('No distinct local handling encounter fixture');
  function finish(action, expectedCode) {
    const before = { elapsed: actor.elapsed, metabolizedKcal: actor.physiology.totals.metabolizedKcal,
      sourceQuantity: source.quantity, targetQuantity: target.quantity, held: actor.inventory.items.length };
    const admission = requestNpcAction(actor, action, environment);
    if (admission.code !== 'ACTION_STARTED') throw new Error(admission.code);
    for (let i = 0; actor.active && i < 240; i++) advance(.25);
    if (actor.active || actor.lastResult?.code !== expectedCode) throw new Error(actor.lastResult?.code || 'Handling action did not settle');
    return { action, result: structuredClone(actor.lastResult), before,
      after: { elapsed: actor.elapsed, metabolizedKcal: actor.physiology.totals.metabolizedKcal,
        sourceQuantity: source.quantity, targetQuantity: target.quantity, held: actor.inventory.items.length } };
  }
  actor.position = { ...sourcePoint }; observeNpc(actor, environment);
  const priorPull = finish({ type: 'pull', targetId: source.id }, 'piece_detached');
  actor.position = { ...targetPoint }; observeNpc(actor, environment);
  if (!appearanceCuesMatch(freshMethodAppearance(actor, source.id)?.cues, freshMethodAppearance(actor, target.id)?.cues))
    throw new Error('The learner lacks fresh matching sensory descriptions');
  const failedGrasp = finish({ type: 'grasp', targetId: target.id }, 'object_still_attached');
  const inquiry = handlingInquiries(actor).find(q => q.sourceId === target.id);
  if (!inquiry || inquiry.status !== 'uncertain' || inquiry.priorSourceId !== source.id ||
    actor.discovery.experiments.some(e => e.primitive === 'sample') || actor.discovery.effects.length || actor.discovery.techniques.length ||
    actor.discovery.reports.length || actor.discovery.inquiries.length) throw new Error('Expected personal motor evidence only');
  state.selectedAgentId = actor.id; state.player = { ...targetPoint };
  const rows = new Map(), storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
  if (!writeOzarkSave(storage, state, geometry)) throw new Error('Handling fixture failed strict save validation: ' + state.saveError);
  return { saveKey: OZARK_SAVE_KEY, raw: rows.get(OZARK_SAVE_KEY), summary: {
    version: state.version, elapsed: state.elapsed, actorId: actor.id, sourceObjectId: source.id, targetObjectId: target.id,
    inquiry, priorPull, failedGrasp, experimentCount: actor.discovery.experiments.length,
    sampleCount: 0, ownEffects: 0, ownTechniques: 0,
    boundary: 'Explicit encounter placement; own paid prior pull and failed grasp, not witnessed consumption, heard advice, autonomous travel or food proof.'
  } };
}

/** Resume pending bytes with fresh actual observations, ask the ordinary
 * controller for its one pull, and either finish it or close after paid effort.
 * Neither branch samples the acquired material or injects bodily feedback. */
export async function continueHandlingInquiryUiFixture(moduleBase, storage, mode = 'complete') {
  if (!['complete', 'interrupt'].includes(mode)) throw new Error('Unknown handling fixture continuation');
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback, discoveryDecision } = await use('discovery');
  const { handlingInquiries, HANDLING_QUESTION } = await use('handling-inquiry');
  const geometry = createOzarkWorldGeometry(), loaded = loadOzarkSave(storage, geometry);
  if (loaded.blocked || !loaded.state) throw new Error(loaded.error || 'No current handling fixture');
  const state = loaded.state, environment = state.environment, actor = state.agents.find(n => n.id === state.selectedAgentId);
  const question = actor.discovery.handlingQuestions.find(q => q.state === 'pending');
  if (!question) throw new Error('Expected an untried own handling question');
  for (const n of state.agents) { bindOzarkWorldAgent(n, geometry, state); observeNpc(n, environment); }
  const target = environment.ecology.plants.find(p => p.id === question.sourceId);
  function snapshot() { return { elapsed: actor.elapsed, metabolizedKcal: actor.physiology.totals.metabolizedKcal,
    targetQuantity: target.quantity, held: actor.inventory.items.length, experimentCount: actor.discovery.experiments.length }; }
  function advance(seconds) {
    for (let passed = 0; passed < seconds - 1e-9; passed += .25) {
      const dt = Math.min(.25, seconds - passed);
      tickEnvironment(environment, dt);
      tickOzarkEcology(environment.ecology, dt, environment, state.agents, {}, geometry);
      for (const n of state.agents) { tickNpc(n, dt, environment); processDiscoveryFeedback(n); }
      state.elapsed = environment.elapsed;
    }
  }
  const before = snapshot(), decision = discoveryDecision(actor);
  if (decision.action.type !== 'pull' || decision.action.targetId !== question.sourceId || decision.reason !== HANDLING_QUESTION)
    throw new Error(`Handling policy chose ${decision.action.type}: ${decision.reason}`);
  const admission = requestNpcAction(actor, decision.action, environment);
  if (admission.code !== 'ACTION_STARTED') throw new Error(admission.code);
  if (mode === 'interrupt') {
    advance(.5);
    if (actor.active?.request.type !== 'pull' || actor.active.request.targetId !== question.sourceId || question.state !== 'attempting')
      throw new Error('Interrupted handling attempt settled too early');
  } else {
    for (let i = 0; actor.active && i < 240; i++) advance(.25);
    if (actor.active || actor.lastResult?.code !== 'piece_detached') throw new Error(actor.lastResult?.code || 'Unfinished handling pull');
  }
  if (actor.discovery.experiments.some(e => e.primitive === 'sample') || actor.discovery.effects.length || actor.discovery.techniques.length)
    throw new Error('Handling curiosity must not automatically sample or invent food proof');
  if (!writeOzarkSave(storage, state, geometry)) throw new Error('Handling continuation failed strict save validation: ' + state.saveError);
  return { saveKey: OZARK_SAVE_KEY, raw: storage.getItem(OZARK_SAVE_KEY), summary: {
    version: state.version, elapsed: state.elapsed, actorId: actor.id, sourceObjectId: question.priorSourceId, targetObjectId: question.sourceId,
    inquiry: handlingInquiries(actor).find(q => q.sourceId === question.sourceId), mode, decision, before, after: snapshot(),
    result: mode === 'complete' ? structuredClone(actor.lastResult) : null, interrupted: mode === 'interrupt',
    experimentCount: actor.discovery.experiments.length, sampleCount: 0, ownEffects: 0, ownTechniques: 0,
  } };
}

/** Verify the one-shot guard after native restart with fresh sensory receipts.
 * This operates on an independent load, not the displayed state. No action is
 * requested, no time advances, and no replacement save is written. */
export async function verifyInterruptedHandlingUiFixture(moduleBase, storage) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { loadOzarkSave } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { observeNpc } = await use('npc');
  const { freshMethodAppearance } = await use('discovery');
  const { handlingExperiment, handlingInquiries } = await use('handling-inquiry');
  const { bodySignals } = await use('interoception');
  const { DISCOVERY_RULES } = await use('discovery-config');
  const geometry = createOzarkWorldGeometry(), loaded = loadOzarkSave(storage, geometry);
  if (loaded.blocked || !loaded.state) throw new Error(loaded.error || 'No interrupted handling fixture');
  const state = loaded.state, actor = state.agents.find(n => n.id === state.selectedAgentId);
  bindOzarkWorldAgent(actor, geometry, state); observeNpc(actor, state.environment);
  const inquiry = handlingInquiries(actor)[0], before = JSON.stringify(actor);
  if (inquiry?.status !== 'unavailable' || actor.active ||
    actor.memory.experience.filter(e => e.details?.result?.code === 'RESTART_INTERRUPTED').length !== 1)
    throw new Error('Restart must cancel the actual handling attempt exactly once');
  const next = handlingExperiment(actor, { body: bodySignals(actor), appearance: id => freshMethodAppearance(actor, id),
    local: id => !!freshMethodAppearance(actor, id) && Math.hypot(actor.position.x - actor.discovery.observations[id].position.x,
      actor.position.y - actor.discovery.observations[id].position.y) <= DISCOVERY_RULES.reach, blocked: () => false });
  if (next !== null || JSON.stringify(actor) !== before || actor.discovery.experiments.some(e => e.primitive === 'sample') ||
    actor.discovery.effects.length || actor.discovery.techniques.length) throw new Error('Interrupted handling attempt replayed or invented food proof');
  return { noReplayAfterFreshObservation: true, interruptedOnce: true, inquiry, elapsed: state.elapsed,
    inventory: structuredClone(actor.inventory), targetQuantity: state.environment.ecology.plants.find(p => p.id === inquiry.sourceId).quantity,
    metabolizedKcal: actor.physiology.totals.metabolizedKcal, experimentCount: actor.discovery.experiments.length,
    sampleCount: 0, ownEffects: 0, ownTechniques: 0 };
}

export function presentHandlingInquiryUi(stage, expected) {
  const require = (value, message) => { if (!value) throw new Error(message); };
  const get = selector => { const node = document.querySelector(selector); require(node, `Missing ${selector}`); return node; };
  const state = window.__ozarkWorld.fullSnapshot(), route = window.__ozarkWorld.snapshot();
  const savedBytes = localStorage.getItem('aincrad.world.v2');
  require(!route.blocked && !route.started, 'Inspect handling fixture before simulation starts');
  require(state.elapsed === expected.elapsed, 'Closed-time progression or wrong handling fixture');
  const actor = state.agents.find(n => n.id === expected.actorId), question = actor.discovery.handlingQuestions.find(q => q.sourceId === expected.targetObjectId);
  const status = { pending: 'uncertain', completed: 'detached', interrupted: 'unavailable' }[stage];
  require(status && question?.priorSourceId === expected.sourceObjectId && question.sourceId !== question.priorSourceId, 'Lost distinct own handling sources');
  require(question.state === ({ pending: 'pending', completed: 'completed', interrupted: 'unavailable' })[stage], 'Wrong restored handling state');
  require(!actor.active && actor.discovery.experiments.length === expected.experimentCount, 'UI cannot resume or create an action');
  require(!actor.discovery.experiments.some(e => e.primitive === 'sample') && !actor.discovery.effects.length && !actor.discovery.techniques.length, 'Motor evidence is not food proof');
  if (stage === 'interrupted') require(actor.memory.experience.filter(e => e.details?.result?.code === 'RESTART_INTERRUPTED').length === 1, 'Missing single restart interruption');
  if (get('#npc-panel').classList.contains('hidden')) get('#open-npc').click();
  // The fixture already selected this actor. Dispatching a redundant change
  // would invoke the application's normal selection save, obscuring evidence
  // that this presentation itself does not rewrite interrupted disk bytes.
  require(state.selectedAgentId === expected.actorId && get('#npc-select').value === expected.actorId, 'Wrong selected handling actor');
  get('#npc-tab-character').click(); get('#npc-discovery-details').open = true;
  const entry = [...document.querySelectorAll('#npc-object-knowledge .knowledge-entry')].find(node => node.dataset.handlingInquirySource === expected.targetObjectId);
  require(entry && entry.dataset.handlingInquiryStatus === status, 'Missing projected handling inquiry');
  const text = entry.textContent;
  for (const phrase of [expected.inquiry.question, 'Own prior motor result', 'not witnessed consumption or heard advice',
    'Similar appearance is uncertain', 'does not establish safety, food benefit or a shared category', 'No sampling is implied']) require(text.includes(phrase), `Missing handling boundary ${phrase}`);
  entry.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = entry.getBoundingClientRect();
  require(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight, 'Handling inquiry is not visible');
  const after = window.__ozarkWorld.fullSnapshot();
  require(JSON.stringify(after.agents) === JSON.stringify(state.agents) && JSON.stringify(after.environment) === JSON.stringify(state.environment) && after.elapsed === state.elapsed,
    'Handling UI changed authoritative state');
  require(localStorage.getItem('aincrad.world.v2') === savedBytes, 'Handling UI rewrote disk bytes');
  return { stage, status, text, sourceObjectId: expected.sourceObjectId, targetObjectId: expected.targetObjectId,
    sampleCount: 0, ownEffects: 0, ownTechniques: 0, readOnly: true,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}
