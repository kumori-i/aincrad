/** Explicit encounter exposure for native UI QA, not autonomous travel or
 * survival evidence. These functions are self-contained so a native harness
 * may serialize them into the sandboxed current-world renderer. No Node APIs,
 * hidden proof injection, runtime fixture hook, or second native harness. */
export async function createPeerTeachingUiFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback } = await use('discovery');
  const { SocialCoordinator } = await use('social');
  const { NpcController } = await use('controller');
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const environment = state.environment, [sender, receiver] = state.agents;
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  function advance(seconds) {
    for (let passed = 0; passed < seconds - 1e-9; passed += .25) {
      const dt = Math.min(.25, seconds - passed);
      tickEnvironment(environment, dt);
      tickOzarkEcology(environment.ecology, dt, environment, state.agents, {}, geometry);
      for (const actor of state.agents) {
        tickNpc(actor, dt, environment);
        processDiscoveryFeedback(actor);
      }
      state.elapsed = environment.elapsed;
    }
  }
  advance(60);
  const plants = [...environment.ecology.plants]
    .filter(plant => plant.kind === 'apple_tree' && plant.quantity > 2)
    .sort((a, b) => Math.hypot(a.position.x - sender.position.x, a.position.y - sender.position.y) -
      Math.hypot(b.position.x - sender.position.x, b.position.y - sender.position.y));
  let source, point;
  for (const plant of plants) {
    point = [{ x: plant.position.x + 45, y: plant.position.y },
      { x: plant.position.x - 45, y: plant.position.y },
      { x: plant.position.x, y: plant.position.y + 45 }]
      .find(p => geometry.canOccupy(p.x, p.y, CONFIG.playerRadius) && geometry.lineOfSight(p, plant.position));
    if (point) { source = plant; break; }
  }
  if (!source) throw new Error('No current-world structural exposure point');
  // Placement is the only encounter shortcut. The sender's timed acquisition,
  // finite material, sampling and later feedback all use ordinary physical APIs.
  for (const actor of state.agents) {
    actor.position = { ...point };
    observeNpc(actor, environment);
  }
  function finish(actor, action) {
    const admission = requestNpcAction(actor, action, environment);
    if (admission.code !== 'ACTION_STARTED') throw new Error(admission.code);
    for (let i = 0; actor.active && i < 240; i++) advance(.25);
    if (actor.active || !actor.lastResult?.ok) throw new Error(actor.lastResult?.code || 'Action did not settle');
    return structuredClone(actor.lastResult);
  }
  const before = { at: sender.elapsed, metabolizedKcal: sender.physiology.totals.metabolizedKcal,
    sourceQuantity: source.quantity };
  const acquired = finish(sender, { type: 'pull', targetId: source.id });
  const sampled = finish(sender, { type: 'sample', targetId: acquired.materialId });
  advance(90);
  if (!sender.discovery.techniques.length) throw new Error('No earned sender technique');
  observeNpc(sender, environment); observeNpc(receiver, environment);
  const social = new SocialCoordinator({ getAgents: () => state.agents,
    getCommunity: () => state.community, getEnvironment: () => environment });
  const controller = new NpcController(sender, { environment, social });
  let delivered;
  try { delivered = controller.perform(social.discoveryDialogue(sender)); }
  finally { controller.dispose(); }
  const report = receiver.discovery.reports.find(row => row.teaching);
  if (delivered.code !== 'SAID' || !report) throw new Error('No actual delivered teaching');
  if (report.status !== 'unverified' || report.cursor !== 0 || report.evidence.length ||
      receiver.discovery.experiments.length || receiver.discovery.techniques.length || receiver.discovery.effects.length)
    throw new Error('Receiver must remain naive; testimony is not own evidence');
  state.selectedAgentId = receiver.id; state.player = { ...point };
  const rows = new Map(), storage = { getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value) };
  if (!writeOzarkSave(storage, state, geometry)) throw new Error('Fixture failed current save validation');
  return { saveKey: OZARK_SAVE_KEY, raw: rows.get(OZARK_SAVE_KEY), summary: {
    version: state.version, features: { ...state.features }, elapsed: state.elapsed,
    sourceObjectId: source.id, senderId: sender.id, receiverId: receiver.id,
    acquired, sampled, before,
    after: { at: sender.elapsed, metabolizedKcal: sender.physiology.totals.metabolizedKcal,
      sourceQuantity: source.quantity },
    message: structuredClone(delivered.message), report: structuredClone(report),
    boundary: 'Explicit encounter fixture; ordinary paid actions and delayed feedback, not autonomous travel or survival.'
  } };
}

/** Run after installing the returned bytes in an EMPTY isolated profile and
 * reloading its current ?test=1 route. Do not start the simulation: the route
 * intentionally permits exact restored-state UI inspection before start(). */
export function presentPeerTeachingUi(stage, expected) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const get = selector => {
    const element = document.querySelector(selector);
    require(element, `Missing UI element: ${selector}`); return element;
  };
  require(stage === 'conversation' || stage === 'knowledge', 'Unknown teaching UI stage');
  require(window.__ozarkWorld, 'Use the isolated current ?test=1 route');
  const state = window.__ozarkWorld.fullSnapshot(), route = window.__ozarkWorld.snapshot();
  require(!route.blocked && !route.started, 'Inspect restored teaching before simulation starts');
  require(state.version === expected.version && state.elapsed === expected.elapsed, 'Wrong restored fixture or elapsed time');
  const receiver = state.agents.find(actor => actor.id === expected.receiverId);
  const report = receiver?.discovery.reports.find(row => row.id === expected.report.id);
  require(report?.status === 'unverified' && report.cursor === 0 && !report.evidence.length &&
    !receiver.discovery.techniques.length && !receiver.discovery.effects.length, 'Receiver must retain secondhand, untried advice');
  if (get('#npc-panel').classList.contains('hidden')) get('#open-npc').click();
  const select = get('#npc-select'); select.value = expected.receiverId;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  require(get('#npc-name').textContent === 'Mira', 'Wrong journal character');
  let evidence;
  if (stage === 'conversation') {
    get('#npc-tab-conversation').click();
    const entry = [...document.querySelectorAll('#journal-messages .journal-entry[data-sender="aster"]')]
      .find(node => node.querySelector('p')?.textContent === expected.message.text);
    require(entry, 'Missing actual sender message');
    require(entry.querySelector('.message-meta')?.textContent.includes('Aster → Mira · nearby · taught procedure'),
      'Missing local sender and teaching attribution');
    require(!get('#journal-conversation').classList.contains('hidden'), 'Conversation is hidden');
    evidence = entry;
  } else {
    get('#npc-tab-character').click();
    get('#npc-discovery-details').open = true;
    const entry = [...document.querySelectorAll('#npc-object-knowledge .knowledge-entry')]
      .find(node => node.querySelector('p')?.textContent === expected.report.text);
    require(entry, 'Missing receiver teaching report');
    const provenance = entry.querySelector('.provenance')?.textContent || '';
    for (const text of ['Taught by Aster', 'Pull → Sample', 'taught procedure; not yet tried',
      'Advice does not grant proficiency.']) require(provenance.includes(text), `Missing knowledge boundary: ${text}`);
    require(!get('#journal-character').classList.contains('hidden'), 'Character knowledge is hidden');
    evidence = entry;
  }
  evidence.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = evidence.getBoundingClientRect();
  require(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight,
    'Teaching evidence is not in the viewport');
  return { stage, character: get('#npc-name').textContent, text: evidence.textContent,
    sourceObjectId: expected.sourceObjectId, reportId: report.id, status: report.status,
    cursor: report.cursor, ownEffects: receiver.discovery.effects.length,
    ownTechniques: receiver.discovery.techniques.length,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}
