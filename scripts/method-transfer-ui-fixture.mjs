// Historical legacy-language regression only. Default main communication is grounded;
// reopened legacy records are archival, not an active main-world language channel.
/** Explicit encounter exposure for native UI QA, not autonomous travel or
 * survival evidence. These functions are self-contained so a native harness
 * may serialize them into the sandboxed current-world renderer. No Node APIs,
 * hidden proof injection, runtime fixture hook, or second native harness. */
export async function createMethodTransferUiFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG, SOCIAL_RULES } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindCommunicationMode } = await use('communication-mode');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback, freshMethodAppearance } = await use('discovery');
  const { SocialCoordinator } = await use('social');
  const { NpcController } = await use('controller');
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const environment = state.environment, [sender, receiver] = state.agents;
  for (const actor of state.agents) {bindCommunicationMode(actor,'legacy');bindOzarkWorldAgent(actor, geometry, state);}
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
  const { DISCOVERY_RULES } = await use('discovery-config');
  const { appearanceCuesMatch } = await use('peer-teaching');
  let source, point, target, receiverPoint;
  // Fixture-only scene selection is explicit. Production matching receives
  // no plant kinds, stock lookup, coordinates from the speaker or chosen IDs.
  search: for (const candidate of plants) {
    for (const other of plants.filter(p=>p.id!==candidate.id&&Math.hypot(p.position.x-candidate.position.x,p.position.y-candidate.position.y)<330)) {
      for(let k=0;k<16;k++) {
        const p={x:other.position.x+45*Math.cos(k*Math.PI/8),y:other.position.y+45*Math.sin(k*Math.PI/8)};
        const q={x:candidate.position.x+45,y:candidate.position.y};
        if(!geometry.canOccupy(p.x,p.y,CONFIG.playerRadius)||!geometry.canOccupy(q.x,q.y,CONFIG.playerRadius)||
          !geometry.lineOfSight(p,other.position)||!geometry.lineOfSight(q,candidate.position)||!geometry.lineOfSight(p,q)||
          Math.hypot(p.x-q.x,p.y-q.y)>SOCIAL_RULES.peerRange||Math.hypot(p.x-candidate.position.x,p.y-candidate.position.y)<=DISCOVERY_RULES.reach)continue;
        sender.position={...q};receiver.position={...p};
        observeNpc(sender,environment);observeNpc(receiver,environment);
        const cues=freshMethodAppearance(sender,candidate.id)?.cues;
        const matches=Object.values(receiver.discovery.observations).filter(o=>freshMethodAppearance(receiver,o.id)&&
          Math.hypot(o.position.x-p.x,o.position.y-p.y)<=DISCOVERY_RULES.reach&&appearanceCuesMatch(o.appearance,cues));
        if(matches.length!==1||matches[0].id!==other.id)continue;
        source=candidate;target=other;point=q;receiverPoint=p;break search;
      }
    }
  }
  if(!source)throw new Error('No unique local cross-source encounter fixture');
  // Placement only: all acquisition, speech, digestion and learning are real.
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
  advance(60);
  if (!sender.discovery.techniques.length) throw new Error('No earned sender technique');
  observeNpc(sender, environment); observeNpc(receiver, environment);
  const social = new SocialCoordinator({ communicationMode:'legacy', getAgents: () => state.agents,
    getCommunity: () => state.community, getEnvironment: () => environment });
  const controller = new NpcController(sender, { environment, social });
  let delivered;
  try { delivered = controller.perform(social.discoveryDialogue(sender)); }
  finally { controller.dispose(); }
  const report = receiver.discovery.reports.find(row => row.teaching);
  if (delivered.code !== 'SAID' || !report || report.teaching.transfer?.targetObjectId!==target.id) throw new Error('No actual delivered teaching');
  if (report.status !== 'unverified' || report.cursor !== 0 || report.evidence.length ||
      receiver.discovery.experiments.length || receiver.discovery.techniques.length || receiver.discovery.effects.length)
    throw new Error('Receiver must remain naive; testimony is not own evidence');
  state.selectedAgentId = receiver.id; state.player = { ...receiverPoint };
  const rows = new Map(), storage = { getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value) };
  if (!writeOzarkSave(storage, state, geometry)) throw new Error('Fixture failed current save validation');
  return { saveKey: OZARK_SAVE_KEY, raw: rows.get(OZARK_SAVE_KEY), summary: {
    version: state.version, features: { ...state.features }, elapsed: state.elapsed,
    sourceObjectId: source.id, targetObjectId:target.id, targetPosition:{...target.position}, senderId: sender.id, receiverId: receiver.id,
    acquired, sampled, before,
    after: { at: sender.elapsed, metabolizedKcal: sender.physiology.totals.metabolizedKcal,
      sourceQuantity: source.quantity },
    message: structuredClone(delivered.message), report: structuredClone(report),
    boundary: 'Explicit encounter fixture; ordinary paid actions and delayed feedback, not autonomous travel or survival.'
  } };
}


/** Continue from actual isolated-profile bytes after a closed native process.
 * Fresh observation is required again; a saved descriptor alone is not sight. */
export async function completeMethodTransferUiFixture(moduleBase, storage) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { loadOzarkSave, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindCommunicationMode } = await use('communication-mode');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback, discoveryDecision } = await use('discovery');
  const geometry=createOzarkWorldGeometry(),loaded=loadOzarkSave(storage,geometry);
  if(loaded.blocked||!loaded.state)throw new Error(loaded.error||'No current method fixture');
  const state=loaded.state,environment=state.environment,receiver=state.agents.find(a=>a.id==='mira');
  const report=receiver.discovery.reports.find(r=>r.teaching?.transfer?.targetObjectId);
  if(!report||report.status!=='unverified'||report.cursor!==0)throw new Error('Expected untried method report');
  for(const actor of state.agents){bindCommunicationMode(actor,'legacy');bindOzarkWorldAgent(actor,geometry,state);observeNpc(actor,environment);}
  function advance(seconds){
    for(let passed=0;passed<seconds-1e-9;passed+=.25){const dt=Math.min(.25,seconds-passed);
      tickEnvironment(environment,dt);tickOzarkEcology(environment.ecology,dt,environment,state.agents,{},geometry);
      for(const actor of state.agents){tickNpc(actor,dt,environment);processDiscoveryFeedback(actor);}state.elapsed=environment.elapsed;}
  }
  const before={elapsed:receiver.elapsed,metabolizedKcal:receiver.physiology.totals.metabolizedKcal,
    sourceQuantity:environment.ecology.plants.find(p=>p.id===report.teaching.transfer.targetObjectId).quantity};
  const outcomes=[];
  for(const type of ['pull','sample']){
    observeNpc(receiver,environment);
    const decision=discoveryDecision(receiver);
    if(decision.action.type!==type)throw new Error(`Method policy chose ${decision.action.type}, expected ${type}: ${decision.reason}`);
    if(type==='pull'&&decision.action.targetId!==report.teaching.transfer.targetObjectId)throw new Error('Policy rebound teacher source');
    const started=requestNpcAction(receiver,decision.action,environment);
    if(started.code!=='ACTION_STARTED')throw new Error(started.code);
    for(let i=0;receiver.active&&i<240;i++)advance(.25);
    if(receiver.active||!receiver.lastResult?.ok)throw new Error(receiver.lastResult?.code||'Unfinished method action');
    outcomes.push({decision,result:structuredClone(receiver.lastResult)});
  }
  if(report.status!=='unverified'||receiver.discovery.techniques.length)throw new Error('Sample is not immediate bodily proof');
  advance(90);
  if(report.status!=='supported'||!receiver.discovery.techniques.some(t=>t.sourceId===report.teaching.transfer.targetObjectId))throw new Error('Missing personal method feedback');
  if(!writeOzarkSave(storage,state,geometry))throw new Error('Tested method fixture failed strict save');
  return {saveKey:OZARK_SAVE_KEY,raw:storage.getItem(OZARK_SAVE_KEY),summary:{version:state.version,elapsed:state.elapsed,
    receiverId:receiver.id,sourceObjectId:report.teaching.sourceObjectId,targetObjectId:report.teaching.transfer.targetObjectId,
    report:structuredClone(report),before,after:{elapsed:receiver.elapsed,metabolizedKcal:receiver.physiology.totals.metabolizedKcal,
      sourceQuantity:environment.ecology.plants.find(p=>p.id===report.teaching.transfer.targetObjectId).quantity},outcomes}};
}

export function presentMethodTransferUi(stage,expected){
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const get=selector=>{const e=document.querySelector(selector);require(e,`Missing ${selector}`);return e;};
  const state=window.__ozarkWorld.fullSnapshot(),route=window.__ozarkWorld.snapshot();
  require(!route.blocked&&!route.started,'Inspect method fixture before simulation starts');
  require(state.elapsed===expected.elapsed,'Closed-time progression or wrong fixture');
  const receiver=state.agents.find(a=>a.id===expected.receiverId),report=receiver.discovery.reports.find(r=>r.id===expected.report.id);
  require(report?.teaching.transfer?.targetObjectId===expected.targetObjectId,'Lost local transfer target');
  require(report.teaching.sourceObjectId!==expected.targetObjectId,'Teacher source is not transfer target');
  require(report.status===expected.report.status&&report.cursor===expected.report.cursor,'Wrong restored personal evidence');
  if(stage==='heard')require(!receiver.discovery.techniques.length&&!receiver.discovery.effects.length,'Hearing cannot supply own proof');
  else require(stage==='tested'&&report.status==='supported'&&receiver.discovery.techniques.some(t=>t.sourceId===expected.targetObjectId),'No personal feedback proof');
  if(get('#npc-panel').classList.contains('hidden'))get('#open-npc').click();
  const select=get('#npc-select');select.value=expected.receiverId;select.dispatchEvent(new Event('change',{bubbles:true}));
  get('#npc-tab-character').click();get('#npc-discovery-details').open=true;
  const entry=[...document.querySelectorAll('#npc-object-knowledge .knowledge-entry')].find(node=>node.querySelector('p')?.textContent===report.text);
  require(entry,'Missing heard method entry');
  require(get('#npc-object-knowledge').textContent.includes('archival and inert'),'Missing default-main archival boundary');
  const text=entry.textContent;
  for(const phrase of ['appearance-based trial',expected.sourceObjectId,expected.targetObjectId,'not proof of safety'])require(text.includes(phrase),`Missing method boundary ${phrase}`);
  if(stage==='tested')require(text.includes('supported by my own bodily experience'),'Missing personally tested provenance');
  entry.scrollIntoView({block:'center',inline:'nearest'});const rect=entry.getBoundingClientRect();
  require(rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight,'Method report not visible');
  return {stage,text,status:report.status,cursor:report.cursor,ownEffects:receiver.discovery.effects.length,
    ownTechniques:receiver.discovery.techniques.length,targetObjectId:expected.targetObjectId,sourceObjectId:expected.sourceObjectId,
    bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
}
