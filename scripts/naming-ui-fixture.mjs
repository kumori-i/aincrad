// Historical legacy-language regression only. Default main communication is grounded;
// reopened legacy records are archival, not an active main-world language channel.
/** Staged native encounter, not autonomous discovery or travel evidence. */
export async function createNamingUiFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG, NPC_RULES } = await use('config');
  const { senseEcology } = await use('ecology');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState: rawCreateOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const {bindCommunicationMode}=await use('communication-mode');
  const historicalState=s=>{for(const n of s.agents)bindCommunicationMode(n,'legacy');return s;};
  const createOzarkState=(...args)=>historicalState(rawCreateOzarkState(...args));
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { SocialCoordinator } = await use('social');
  const { lexicalLabels, chooseOwnName } = await use('naming-state');
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry), environment = state.environment;
  const [speaker, listener] = state.agents;
  for (const npc of state.agents) bindOzarkWorldAgent(npc, geometry, state);
  function advance(seconds) {
    for (let t = 0; t < seconds - 1e-9; t += .25) {
      const dt = Math.min(.25, seconds - t);
      tickEnvironment(environment, dt); tickOzarkEcology(environment.ecology, dt, environment, state.agents, {}, geometry);
      for (const npc of state.agents) tickNpc(npc, dt, environment);
      state.elapsed = environment.elapsed;
    }
  }
  advance(60);
  // First physically eligible, uniquely pointable source, without consulting naming outcome.
  const source = environment.ecology.plants.find(p => {
    const a = { x: p.position.x + 45, y: p.position.y }, b = { x: p.position.x + 50, y: p.position.y + 10 };
    return p.quantity > 0 && [a, b].every(q => geometry.canOccupy(q.x, q.y, CONFIG.playerRadius) && geometry.lineOfSight(q, p.position)) && geometry.lineOfSight(a, b) &&
      senseEcology(environment.ecology,b,'valley',NPC_RULES.visionRadius).filter(o=>geometry.lineOfSight(b,o.position)&&Math.hypot(o.position.x-p.position.x,o.position.y-p.position.y)<=12).length===1;
  });
  if (!source) throw new Error('No physically eligible staged naming source');
  speaker.position = { x: source.position.x + 45, y: source.position.y };
  listener.position = { x: source.position.x + 50, y: source.position.y + 10 };
  for (const npc of state.agents) observeNpc(npc, environment);
  const before = { elapsed: speaker.elapsed, energy: speaker.physiology.totals.metabolizedKcal };
  let own, inspections = 0;
  // Disclosed bounded repeated encounters at this same fixed target. Neither
  // the seed nor target changes in response to a declined naming choice.
  for (; inspections < 4 && !own; inspections++) {
    const admission = requestNpcAction(speaker, { type: 'inspect_object', targetId: source.id }, environment);
    if (admission.code !== 'ACTION_STARTED') throw new Error(admission.code);
    for (let i = 0; speaker.active && i < 100; i++) advance(.25);
    if (speaker.active || speaker.lastResult?.code !== 'OBJECT_OBSERVED') throw new Error('Paid naming encounter failed');
    // Explicit historical seeded-name fixture, not current model inference.
    chooseOwnName(speaker,speaker.discovery.experiments.at(-1),{objectId:source.id,at:speaker.elapsed,scene:speaker.scene,actorPosition:{...speaker.position},objectPosition:{...source.position}});
    own = lexicalLabels(speaker).find(row => row.objectId === source.id && row.status === 'owner-chosen');
  }
  if (!own) throw new Error('Bounded fixed-target encounters did not produce a name; no favorable-outcome search performed');
  const social = new SocialCoordinator({communicationMode:'legacy', getAgents: () => state.agents, getCommunity: () => state.community, getEnvironment: () => environment });
  social.tick(.1);
  const heard = lexicalLabels(listener).find(row => row.objectId === source.id && row.speakerId === speaker.id);
  if (heard?.status !== 'heard-grounded') throw new Error('First local pointing did not ground a name: ' + JSON.stringify({safe:state.agents.map(n=>social.naming.safe(n)),ready:state.agents.map(n=>social.naming.ready(n)),source:source.id,own:speaker.lexicon,heard:listener.lexicon,messages:state.community.messages,clocks:[state.elapsed,...state.agents.map(n=>n.elapsed)]}));
  social.dispose();
  state.selectedAgentId = listener.id; state.player = { ...listener.position };
  const rows = new Map(), storage = { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v) };
  if (!writeOzarkSave(storage, state, geometry)) throw new Error('Naming fixture save rejected: ' + state.saveError);
  return { saveKey: OZARK_SAVE_KEY, raw: rows.get(OZARK_SAVE_KEY), summary: { elapsed: state.elapsed, actorId: listener.id,
    speakerId: speaker.id, sourceObjectId: source.id, token: own.token, status: 'heard-grounded', inspections, before,
    after: { elapsed: speaker.elapsed, energy: speaker.physiology.totals.metabolizedKcal },
    boundary: 'Legacy seeded-name fixture with staged encounter placement, bounded repeated genuine paid inspections and local pointing, not autonomous travel, categories or food proof.' } };
}

/** Separate restart/fresh-sight reference check, or interruption after request. */
export async function continueNamingUiFixture(moduleBase, storage, mode = 'complete') {
  if (!['complete', 'interrupt'].includes(mode)) throw new Error('Unknown naming continuation');
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, tickNpc } = await use('npc');
  const { SocialCoordinator } = await use('social');
  const { lexicalLabels, chooseOwnName } = await use('naming-state');
  const geometry = createOzarkWorldGeometry(), loaded = loadOzarkSave(storage, geometry);
  if (loaded.blocked || !loaded.state) throw new Error(loaded.error || 'Missing naming fixture');
  const state = loaded.state, environment = state.environment, listener = state.agents.find(n => n.id === state.selectedAgentId);
  for (const npc of state.agents) { bindOzarkWorldAgent(npc, geometry, state); observeNpc(npc, environment); }
  const heard = lexicalLabels(listener).find(row => row.status === 'heard-grounded');
  if (!heard) throw new Error('Missing grounded association');
  const social = new SocialCoordinator({communicationMode:'legacy', getAgents: () => state.agents, getCommunity: () => state.community, getEnvironment: () => environment });
  let observedPending = false;
  for (let i = 0; i < 400; i++) {
    tickEnvironment(environment, .25); tickOzarkEcology(environment.ecology, .25, environment, state.agents, {}, geometry);
    for (const npc of state.agents) tickNpc(npc, .25, environment);
    state.elapsed = environment.elapsed; social.tick(.25);
    observedPending ||= social.naming.pendingCount() > 0;
    if (mode === 'interrupt' && observedPending || mode === 'complete' && lexicalLabels(listener).some(row => row.objectId === heard.objectId && row.status === 'confirmed')) break;
  }
  const status = lexicalLabels(listener).find(row => row.objectId === heard.objectId && row.speakerId === heard.speakerId)?.status;
  if (!observedPending || (mode === 'complete' ? status !== 'confirmed' : status !== 'heard-grounded')) throw new Error('Naming reference protocol did not reach requested checkpoint');
  const pendingAtClose = social.naming.pendingCount(); social.dispose();
  if (social.naming.pendingCount() !== 0) throw new Error('Naming disposal did not clear pending exchanges');
  if (!writeOzarkSave(storage, state, geometry)) throw new Error('Naming continuation save rejected: ' + state.saveError);
  return { saveKey: OZARK_SAVE_KEY, raw: storage.getItem(OZARK_SAVE_KEY), summary: { elapsed: state.elapsed,
    actorId: listener.id, speakerId: heard.speakerId, sourceObjectId: heard.objectId, token: heard.token, status, mode, pendingAtClose } };
}

export function presentNamingUi(expected) {
  const require = (value, message) => { if (!value) throw new Error(message); };
  const get = selector => { const node = document.querySelector(selector); require(node, `Missing ${selector}`); return node; };
  const state = window.__ozarkWorld.fullSnapshot(), route = window.__ozarkWorld.snapshot(), bytes = localStorage.getItem('aincrad.world.v2');
  require(!route.blocked && !route.started && state.elapsed === expected.elapsed, 'Naming close/reopen changed time or failed boot');
  require(state.selectedAgentId === expected.actorId, 'Wrong selected naming agent');
  if (get('#npc-panel').classList.contains('hidden')) get('#open-npc').click();
  get('#npc-tab-character').click(); get('#npc-discovery-details').open = true;
  const entry = [...document.querySelectorAll('#npc-object-knowledge .knowledge-entry')].find(node => node.dataset.namingObject === expected.sourceObjectId && node.dataset.namingSpeaker === expected.speakerId);
  require(entry && entry.dataset.namingStatus === expected.status, 'Missing source-qualified naming evidence');
  require(entry.textContent.includes(expected.token) && entry.textContent.includes(expected.sourceObjectId), 'Missing name or ID fallback');
  entry.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = entry.getBoundingClientRect();
  require(rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0, 'Name evidence not visible');
  const after = window.__ozarkWorld.fullSnapshot();
  require(JSON.stringify(after.agents) === JSON.stringify(state.agents) && JSON.stringify(after.environment) === JSON.stringify(state.environment) && after.elapsed === state.elapsed, 'Naming rendering changed simulation');
  require(localStorage.getItem('aincrad.world.v2') === bytes, 'Naming rendering changed saved bytes');
  return { status: expected.status, text: entry.textContent, readOnly: true, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
}

/** Fresh observations after restart cannot recreate the spent pending check. */
export async function verifyInterruptedNamingUiFixture(moduleBase, storage) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { loadOzarkSave } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { observeNpc, tickNpc } = await use('npc');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { SocialCoordinator } = await use('social');
  const { lexicalLabels, chooseOwnName } = await use('naming-state');
  const geometry = createOzarkWorldGeometry(), loaded = loadOzarkSave(storage, geometry);
  if (loaded.blocked || !loaded.state) throw new Error(loaded.error || 'Missing interrupted naming save');
  const state = loaded.state, environment = state.environment;
  for (const n of state.agents) { bindOzarkWorldAgent(n, geometry, state); observeNpc(n, environment); }
  const social = new SocialCoordinator({communicationMode:'legacy', getAgents: () => state.agents, getCommunity: () => state.community, getEnvironment: () => environment });
  if (social.naming.pendingCount() !== 0) throw new Error('Pending check restored');
  const before = JSON.stringify(state.agents.map(n => n.lexicon)), messages = state.community.messages.length;
  for (let i = 0; i < 400; i++) {
    tickEnvironment(environment, .25); tickOzarkEcology(environment.ecology, .25, environment, state.agents, {}, geometry);
    for (const n of state.agents) tickNpc(n, .25, environment);
    state.elapsed = environment.elapsed; social.tick(.25);
  }
  if (JSON.stringify(state.agents.map(n => n.lexicon)) !== before || social.naming.pendingCount() || state.community.messages.length !== messages ||
    state.agents.some(n => lexicalLabels(n).some(row => row.status === 'confirmed'))) throw new Error('Interrupted check replayed after fresh sight');
  social.dispose(); return { noReplayAfterFreshSight: true, elapsedWindow: 100, confirmedCount: 0 };
}
