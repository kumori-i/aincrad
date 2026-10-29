// Historical legacy-language regression only. Default main communication is grounded;
// reopened legacy records are archival, not an active main-world language channel.
/** Explicit encounter exposure for native UI QA, not autonomous travel or
 * survival evidence. These functions are self-contained so a native harness
 * may serialize them into the sandboxed current-world renderer. No Node APIs,
 * hidden proof injection, runtime fixture hook, or second native harness. */
export async function createPeerTeachingUiFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState: rawCreateOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const {bindCommunicationMode}=await use('communication-mode');
  const historicalState=s=>{for(const n of s.agents)bindCommunicationMode(n,'legacy');return s;};
  const createOzarkState=(...args)=>historicalState(rawCreateOzarkState(...args));
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
  const social = new SocialCoordinator({communicationMode:'legacy', getAgents: () => state.agents,
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
  const hintText=`If ${source.id} is not moving, strike it until it falls, then eat it`;
  const human=social.postUserMessage(hintText,{to:receiver.id});
  const humanReport=receiver.discovery.reports.find(row=>row.messageId===human.message?.id);
  if(!human.ok||humanReport?.hint?.code!=='unsupported'||humanReport.proposed.length)
    throw new Error('Unsupported whole hint must remain an inert attributed report');
  const humanReply=social.discoveryDialogue(receiver);
  if(!humanReply?.text.includes('No physical steps proposed'))throw new Error('Missing bounded hint explanation');
  const receiverController=new NpcController(receiver,{communicationMode:'legacy',environment,social});
  try { receiverController.perform(humanReply); } finally { receiverController.dispose(); }
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
    humanReport:structuredClone(humanReport), humanReply:humanReply.text,
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
  require(stage === 'learning' || stage === 'knowledge' || stage === 'human-hint', 'Unknown teaching UI stage');
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
  if (stage === 'learning') {
    get('#npc-tab-conversation').click();
    const stream = get('#journal-messages');
    require(get('#npc-tab-conversation').textContent.trim() === 'Learning', 'Main tab must be Learning');
    require(stream.textContent.includes('Observer annotations, not agent speech'), 'Missing observer-only boundary');
    require(!stream.textContent.includes(expected.message.text), 'Archived teaching leaked into live learned communication');
    require(!stream.querySelector('[data-sender]') && !stream.querySelector('[data-learning-event]'),
      'Reopened unstarted world fabricated a speech or symbol event');
    require(get('#journal-form').classList.contains('hidden'), 'Human instruction form remains live');
    require(get('#npc-controller').textContent.includes('English communication disabled'), 'Wrong main capability');
    require(!get('#journal-conversation').classList.contains('hidden'), 'Learning tab is hidden');
    evidence = stream;
  } else {
    get('#npc-tab-character').click();
    get('#npc-discovery-details').open = true;
    require(get('#npc-object-knowledge').textContent.includes('archival and inert'), 'Missing archival report boundary');
    const entry = [...document.querySelectorAll('#npc-object-knowledge .knowledge-entry')]
      .find(node => node.querySelector('p')?.textContent === (stage==='human-hint'?expected.humanReport.text:expected.report.text));
    require(entry, 'Missing receiver teaching report');
    const provenance = entry.querySelector('.provenance')?.textContent || '';
    if(stage==='human-hint'){
      require(entry.textContent.includes('No physical steps proposed')&&entry.textContent.includes('restricted command grammar'),'Missing whole-hint rejection help');
      require(receiver.discovery.reports.find(row=>row.id===expected.humanReport.id)?.proposed.length===0,'Rejected hint resumed physical steps');
    }else for (const text of ['Taught by Aster', 'Pull → Sample', 'taught procedure; not yet tried',
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
    archivalReportsInert: true, liveEnglishDisabled: true,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}
