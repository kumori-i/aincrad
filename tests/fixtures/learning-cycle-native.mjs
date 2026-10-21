/** Serializable renderer fixture. Positions are staged; all acquisition,
 * consumption, decisions, feedback, and elapsed time use ordinary runtime APIs. */
export async function createLearningCycleFixture(moduleBase, {control = 'observed', pending = true, progress = () => {}} = {}) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const {CONFIG, NPC_RULES} = await use('config');
  const {createOzarkWorldGeometry} = await use('ozark-world-geometry');
  const {createOzarkState, writeOzarkSave, OZARK_SAVE_KEY} = await use('ozark-save');
  const {bindOzarkWorldAgent} = await use('ozark-agent-world');
  const {PopulationRuntime} = await use('population');
  const {bindOzarkEcology} = await use('ozark-ecology');
  const {requestNpcAction, observeNpc} = await use('npc');
  const {observationalInquiries} = await use('observational-learning');
  const {discoveryDecision} = await use('discovery');
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const [sender, receiver] = state.agents, ecology = state.environment.ecology;
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  let source, point, hidden;
  for (const plant of ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>3)
    .sort((a,b)=>Math.hypot(a.position.x-276,a.position.y-760)-Math.hypot(b.position.x-276,b.position.y-760))) {
    const points = Array.from({length:16},(_,i)=>({x:plant.position.x+48*Math.cos(i*Math.PI/8),y:plant.position.y+48*Math.sin(i*Math.PI/8)}));
    point = points.find(p=>geometry.canOccupy(p.x,p.y,CONFIG.playerRadius)&&geometry.lineOfSight(p,plant.position));
    if (!point) continue;
    { // Use the same source/encounter in every paired control.
      hidden = Array.from({length:64},(_,i)=>({x:point.x+140*Math.cos(i*Math.PI/32),y:point.y+140*Math.sin(i*Math.PI/32)}))
        .find(p=>geometry.canOccupy(p.x,p.y,CONFIG.playerRadius)&&!geometry.lineOfSight(p,point));
      if (!hidden) continue;
    }
    source=plant; break;
  }
  require(source, 'No staged physical encounter location');
  sender.position={...point}; receiver.position={...point}; state.player={...point};
  const runtime = new PopulationRuntime(state,{cardinal:false});
  const trace=[], inputOrigins=new WeakMap();
  function step(freeReceiver=false) {
    for (const actor of state.agents) if (!actor.active && !(actor===receiver&&freeReceiver)) {
      const result=requestNpcAction(actor,{type:'wait',seconds:5},state.environment);
      require(result.ok, 'Fixture wait failed: '+JSON.stringify(result));
      if(actor.active)inputOrigins.set(actor.active,'fixture-wait');
    }
    runtime.tick(CONFIG.fixedStep); state.elapsed=state.environment.elapsed;
    if(freeReceiver && receiver.active && trace.at(-1)?.startedAt!==receiver.active.startedAt){
      const inputOrigin=inputOrigins.get(receiver.active)||'ordinary-controller';
      trace.push({at:receiver.elapsed,startedAt:receiver.active.startedAt,inputOrigin,action:structuredClone(receiver.active.request),...(inputOrigin==='ordinary-controller'?{reason:receiver.decision}:{})});
    }
  }
  function advance(seconds,free=false){for(let i=0;i<Math.ceil(seconds/CONFIG.fixedStep);i++)step(free);}
  function drain(actor){for(let i=0;actor.active&&i<1200;i++)step();require(!actor.active,'Fixture action did not finish');}
  function finish(actor,action){drain(actor);const admitted=requestNpcAction(actor,action,state.environment);require(admitted.code==='ACTION_STARTED','Admission failed: '+JSON.stringify(admitted));inputOrigins.set(actor.active,actor===sender?'donor-command':'fixture-command');drain(actor);require(actor.lastResult?.ok,'Paid action failed: '+JSON.stringify(actor.lastResult));return structuredClone(actor.lastResult);}
  try {
    // Keep body and ecology clocks ordinary; no injected hunger, receipt or proof.
    advance(1); progress('ready');
    observeNpc(sender,state.environment);
    const acquired=finish(sender,{type:'pull',targetId:source.id});
    const materialId=acquired.materialId;
    if(control==='no-observation') receiver.position={x:point.x+NPC_RULES.visionRadius+500,y:point.y};
    else if(control==='occluded') receiver.position={...hidden};
    const witnessPosition={...receiver.position};
    observeNpc(receiver,state.environment);
    const beforeProof={effects:receiver.discovery.effects.length,experiments:receiver.discovery.experiments.length,techniques:receiver.discovery.techniques.length};
    const sampled=finish(sender,{type:'sample',targetId:materialId}); progress('witnessed');
    const atWitness=structuredClone(observationalInquiries(receiver).find(q=>q.sourceId===materialId)||null);
    require(receiver.discovery.effects.length===beforeProof.effects&&receiver.discovery.techniques.length===beforeProof.techniques,'Witness copied personal proof');
    if(['no-observation','occluded'].includes(control))require(!atWitness,'Unseen consumption created inquiry');
    else require(atWitness?.status==='uncertain'&&atWitness.ownAttempts.length===0&&atWitness.ownEffects.length===0,'Visible consumption must create uncertainty only');
    finish(sender,{type:'release',targetId:materialId});
    const released=structuredClone(ecology.materials.find(row=>row.id===materialId));
    require(released?.massGrams>0&&!released.heldBy,'Donor must release finite unowned remainder');
    receiver.position={...point}; observeNpc(receiver,state.environment);
    if(['no-observation','occluded'].includes(control)) {
      advance(2);
      require(!observationalInquiries(receiver).some(q=>q.sourceId===materialId),'Later perception replayed missed consumption');
      return {summary:{control,passed:true,controlScope:'perception admission and missed-event nonreplay, not policy-choice comparison',witnessPosition,sourcePosition:point,materialId,atWitness,ownEffects:receiver.discovery.effects.length,fixtureDisclosure:'Same deterministic world and source, staged local positions; actual donor consumption. Later perception cannot reconstruct a missed event. No autonomous survival claim.'}};
    }
    // Release the recipient from fixture waits. Its next actions are selected by
    // the ordinary discovery policy, not prescribed by this fixture.
    drain(receiver);
    observeNpc(receiver,state.environment);
    const choices=[];
    for(const enabled of [true,false]){
      const shadowState=structuredClone(state),shadow=shadowState.agents.find(row=>row.id===receiver.id);
      bindOzarkEcology(shadowState.environment.ecology,geometry);
      if(!enabled)shadow.discovery.inquiries=[];
      for(const actor of shadowState.agents)bindOzarkWorldAgent(actor,geometry,shadowState);
      observeNpc(shadow,shadowState.environment);
      const decision=discoveryDecision(shadow);
      choices.push({inquiriesEnabled:enabled,action:decision.action,reason:decision.reason});
    }
    const choiceAblation={sameStateAndRng:true,choices,nextActionDiffers:JSON.stringify(choices[0].action)!==JSON.stringify(choices[1].action)};
    require(choices[0].action.type==='grasp'&&choices[0].action.targetId===materialId,'Witness did not direct exact-target next choice: '+JSON.stringify(choiceAblation));
    require(choiceAblation.nextActionDiffers,'Fixed-seed inquiry ablation did not change the next concrete action: '+JSON.stringify(choiceAblation));
    progress('choice '+JSON.stringify(choiceAblation));
    const beforeTrial={at:receiver.elapsed,metabolizedKcal:receiver.physiology.totals.metabolizedKcal};
    for(let i=0;i<2400;i++){
      step(true);
      const q=observationalInquiries(receiver).find(q=>q.sourceId===materialId);
      if(q?.ownAttempts.some(e=>e.primitive==='grasp'&&e.ok) && control==='nonconsumption')break;
      if(q?.ownAttempts.some(e=>e.primitive==='sample'&&e.ok))break;
    }
    let q=observationalInquiries(receiver).find(q=>q.sourceId===materialId);
    require(q?.ownAttempts.some(e=>e.primitive==='grasp'&&e.ok&&e.durationSeconds>0),'Inquiry did not cause an executed grasp: '+JSON.stringify({q,trace}));
    require(trace.some(t=>t.action?.type==='grasp'&&t.action.targetId===materialId&&t.reason?.includes('observed act is not proof')),'Missing policy decision provenance');
    if(control==='nonconsumption') {
      require(!q.ownAttempts.some(e=>e.primitive==='sample'),'Nonconsumption control sampled');
      advance(100);
      q=observationalInquiries(receiver).find(q=>q.sourceId===materialId);
      require(q.ownEffects.length===0&&receiver.discovery.effects.length===0&&receiver.discovery.techniques.length===0,'Ownership/witness manufactured food proof');
      return {summary:{control,passed:true,inquiry:q,choiceAblation,trace,fixtureDisclosure:'Staged encounter and donor actions; ordinary recipient inquiry acquisition; fixture withholds subsequent decisions using paid waits. No recipient consumption or food proof.'}};
    }
    require(q.ownAttempts.some(e=>e.primitive==='sample'&&e.ok),'Inquiry did not execute sample');
    advance(100);
    q=observationalInquiries(receiver).find(q=>q.sourceId===materialId);
    require(q.status==='supported'&&q.ownEffects.some(e=>e.effect==='sustained'),'Own delayed feedback absent: '+JSON.stringify(q));
    const completed=structuredClone(q); progress('feedback');
    const consumed=ecology.materials.find(row=>row.id===materialId);
    require(consumed?.heldBy===receiver.id&&consumed.massGrams<released.massGrams,'Own sample must debit the real released remainder');
    require(receiver.elapsed>beforeTrial.at&&receiver.physiology.totals.metabolizedKcal>beforeTrial.metabolizedKcal,'Own experiment must pay time and metabolism');
    let interrupted=null;
    if(pending){
      observeNpc(sender,state.environment);
      const second=finish(sender,{type:'pull',targetId:source.id});
      finish(sender,{type:'sample',targetId:second.materialId});
      finish(sender,{type:'release',targetId:second.materialId});
      observeNpc(receiver,state.environment);drain(receiver);
      for(let i=0;i<2400;i++){step(true);if(receiver.active?.request?.type==='sample'&&receiver.active.request.targetId===second.materialId)break;}
      require(receiver.active?.request?.type==='sample'&&receiver.active.request.targetId===second.materialId,'No inquiry sample to interrupt: '+JSON.stringify({inquiries:observationalInquiries(receiver),trace:trace.slice(-15)}));
      interrupted={materialId:second.materialId,sourceQuantity:source.quantity,active:structuredClone(receiver.active),inquiry:observationalInquiries(receiver).find(q=>q.sourceId===second.materialId),experiments:receiver.discovery.experiments.length};
      require(receiver.inventory.items.includes(second.materialId),'Pending sample must preserve owned successor');
    }
    state.selectedAgentId=receiver.id;
    const rows=new Map(),storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};
    const saved=writeOzarkSave(storage,state,geometry);
    require(saved&&saved.ok!==false&&rows.has(OZARK_SAVE_KEY),'Strict save failed: '+JSON.stringify(saved));
    return {saveKey:OZARK_SAVE_KEY,raw:rows.get(OZARK_SAVE_KEY),summary:{control,passed:true,senderId:sender.id,receiverId:receiver.id,sourceId:source.id,materialId,acquired,sampled,released,beforeTrial,choiceAblation,atWitness,completed,interrupted,trace,
      fixtureDisclosure:'Staged encounter positions and donor pull/sample/release; ordinary recipient policy selects and pays for inquiry grasp/sample. Shared clocks and own delayed feedback are real. Fixture waits limit unrelated actions. Not autonomous travel, natural encounter rate, general food safety or survival evidence.'}};
  } finally {runtime.dispose();}
}
