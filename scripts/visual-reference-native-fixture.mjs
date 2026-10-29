/** Engineering-only, deliberate phase-A exercise of the actual main state and
 * PopulationRuntime. It neither creates a population nor owns a second clock. */
export function visualReferenceEvidence(state) {
  return structuredClone({elapsed:state.elapsed,player:state.player,playerBody:state.playerBody,
    distance:state.distance,selectedAgentId:state.selectedAgentId,community:state.community,
    clocks:{environmentElapsed:state.environment.elapsed,ecologyElapsed:state.environment.ecology.elapsed,ecologyPending:state.environment.ecology.pending},
    agents:state.agents.map(n=>({id:n.id,position:n.position,elapsed:n.elapsed,active:n.active??null,
      epoch:n.epoch,lifecycle:n.lifecycle,rng:n.rng,inventory:n.inventory,stats:n.stats,
      memory:n.memory,discovery:n.discovery,physiology:n.physiology,lexicon:n.lexicon??null,social:n.social}))});
}

/** Serialized into the sandboxed renderer by the native runner. auditSensor is
 * accepted only by Node preparation tests; native runs use the real Canvas sensor. */
export async function installVisualReferenceFixture(context,moduleBase,projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {observeNpc,requestNpcAction,requestNpcIndication,cancelNpcAction}=await use('npc');
  const {createIndicationPermit,publicIndicationGeometry,discoveryActionPaidSeconds,successfulDiscoveryActionCompletion}=await use('discovery-actions');
  const {observeIndication,senseReferenceObjects,resolveIndication}=await use('visual-reference-perception');
  const {createCommunicationPixelSensor}=await use('communication-pixels');
  const {npcEffortCost}=await use('npc-effort-funding');
  const {loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {state,populationState,reference,geometry,renderer,step,fixedStep,checkpoint:saveCheckpoint}=context;
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const near=(a,b,label)=>require(Math.abs(a-b)<1e-7,`${label}: ${a} != ${b}`);
  require(state===populationState&&state.elapsed===0&&state.agents.length===2,'Expected fresh actual main state/population');
  near(fixedStep,1/60,'Actual main fixed step');
  require(reference?.snapshot().phase==='physical-reference-no-learning','Expected actual phase-A attachment');
  const [sender,listener]=state.agents,initialPositions=state.agents.map(n=>({...n.position}));
  const sensor=context.auditSensor||createCommunicationPixelSensor(document);
  const actualCanvas=!context.auditSensor;
  const audit=[],steps=[],checks={};
  let choiceActive,indicationActive,pendingActive,pendingPermit,privateTargetId,choiceProof,indicationProof,baseline;
  let phase='ready';
  const holdUntil=state.elapsed+20;
  // Bounded deliberate command scheduling, NOT bodily holds: the same ordinary
  // population still integrates every environment, ecology and body fixed step.
  for(const n of state.agents){n.nextDecisionAt=holdUntil;observeNpc(n,state.environment);}
  if(renderer){renderer.followNpc=true;renderer.followId=sender.id;renderer.targetZoom=2;renderer.snap(sender.position);}
  const project=()=>projectEvidence(state);
  const pose=()=>publicIndicationGeometry(sender);
  const noUpdates=()=>{
    const s=reference.snapshot();
    require(s.updates===0&&s.positive===0&&s.negative===0&&s.relief===0&&s.discomfort===0&&s.learners.length===0,'Phase A cannot train or pay a reward');
    require(s.observationEvents.every(e=>e.reward===null),'No reference reward');return s;
  };
  const tick=()=>{
    require(state.elapsed+fixedStep<=holdUntil+1e-8,'Fixture exceeded bounded deliberate scheduling');
    const before={at:state.elapsed,environment:state.environment.elapsed,ecology:state.environment.ecology.elapsed+state.environment.ecology.pending,
      agents:state.agents.map(n=>({id:n.id,at:n.elapsed,metabolized:n.physiology.totals.metabolizedKcal}))};
    for(const n of state.agents)n.nextDecisionAt=holdUntil;
    require(step()!==false,'Actual main step rejected');
    near(state.elapsed-before.at,fixedStep,'Main world paid time');
    near(state.environment.elapsed-before.environment,fixedStep,'Environment paid time');
    near(state.environment.ecology.elapsed+state.environment.ecology.pending-before.ecology,fixedStep,'Ecology paid time');
    for(const n of state.agents)near(n.elapsed-before.agents.find(a=>a.id===n.id).at,fixedStep,'Body paid time');
    steps.push({from:before.at,to:state.elapsed,dt:fixedStep});
    const g=pose();
    if(g){
      require(Object.keys(g).sort().join(',')==='origin,progress,scene,tip','Public geometry leaks target metadata');
      near(Math.hypot(g.tip.x-g.origin.x,g.tip.y-g.origin.y),24,'Fixed schematic segment');
      const sensed=senseReferenceObjects(listener,state),numeric=resolveIndication(g,sensed.objects),seen=observeIndication(listener,sender,state);
      require(sensed.complete&&seen.reason==='resolved','Actual listener failed current visible correspondence');
      require(numeric.index===seen.index&&sensed.bindings[numeric.index]===seen.objectId,'Binding must follow numeric geometry parser');
      // Private test witness is compared only after observation. It is never
      // passed to the parser, the listener or the attachment as an answer.
      require(seen.objectId===privateTargetId,'Private actuator witness and listener geometry disagree');
      audit.push({at:state.elapsed,listenerAt:listener.elapsed,geometry:g,numericInput:sensed.objects,numericResult:numeric,
        localBinding:seen.objectId,reason:seen.reason,paidSeconds:discoveryActionPaidSeconds(sender,sender.active)});
    }
    noUpdates();
  };
  const until=(condition,label,max=180)=>{for(let i=0;!condition()&&i<max;i++)tick();require(condition(),label);};
  const status=()=>({phase,elapsed:state.elapsed,pose:pose(),reference:noUpdates(),privateWitness:{targetId:privateTargetId??null,
    choice:choiceProof??null,indication:indicationProof??null},audit:structuredClone(audit),steps:structuredClone(steps),checks:{...checks}});
  function beginChoice(){
    require(phase==='ready'&&!pose(),'Before choice there must be no paid cue');
    const action=reference.hooks.optionalAction(listener);
    require(action?.type==='inspect_object','Initial real Canvas observations did not admit a distinguishable pair');
    const result=requestNpcAction(listener,action,state.environment);choiceActive=listener.active;
    reference.hooks.performed(listener,action,result,choiceActive);
    require(result.code==='ACTION_STARTED'&&choiceActive,'Deliberate listener inspect did not start');
    require(!pose(),'An unfinished listener choice cannot produce a cue');phase='choice';return status();
  }
  function completeChoice(){
    require(phase==='choice','Expected listener choice');
    until(()=>listener.active!==choiceActive,'Paid listener inspect did not finish');
    choiceProof=successfulDiscoveryActionCompletion(listener,choiceActive);
    require(choiceProof?.type==='inspect_object'&&choiceProof.worked>0,'No canonical successful paid inspect witness');
    near(choiceProof.worked,choiceActive.seconds,'Full paid listener inspection');
    require(reference.snapshot().latest.status==='awaiting-indication'&&!pose(),'Sender indication preceded completed listener choice');
    checks.choiceCompletedBeforeIndication=true;phase='choice-complete';return status();
  }
  function beginIndication(){
    require(phase==='choice-complete'&&!pose(),'Expected completed choice and no cue');
    const action=reference.hooks.optionalAction(sender);
    require(action?.type==='indicate_object','No post-choice indication request');
    const result=reference.hooks.performOptional(sender,action);indicationActive=sender.active;
    require(result.code==='ACTION_STARTED'&&indicationActive,'Paid sender indication did not start');
    privateTargetId=indicationActive.request.targetId;
    require(!pose(),'Unfunded cue must remain absent');
    baseline={at:state.elapsed,metabolized:sender.physiology.totals.metabolizedKcal,available:sender.physiology.availableEnergyKcal,
      inventory:structuredClone(sender.inventory),experiments:sender.discovery.experiments.length};
    phase='indicating';return status();
  }
  function visible(){
    require(phase==='indicating','Expected paid indication');for(let i=0;i<24;i++)tick();
    require(pose()&&audit.length>=23,'No sustained visible public cue');
    const crop=sensor.capture(listener,state).get(privateTargetId);
    require(crop?.pixels?.length===768&&crop.features?.length===48,'Missing actual current listener crop');
    checks.visibleCrop={actualCanvas,pixels:crop.pixels.slice(),features:crop.features.slice(),at:crop.at,epoch:crop.epoch};
    const current=senseReferenceObjects(listener,state),g=pose(),index=current.bindings.indexOf(privateTargetId);
    require(index>=0,'Private referent absent from ordinary visible set');
    const ambiguous=resolveIndication(g,[...current.objects,current.objects[index]]);
    require(ambiguous.reason==='ambiguous'&&ambiguous.index===null,'Competing geometry must fail closed');
    checks.numericAmbiguity={scope:'Read-only duplicate numeric observation, not an injected world object',result:ambiguous};
    // Use a read-only observer copy at an actually valid but occluded physical
    // position. The main population and its geometry are never changed.
    let blocked=null;
    for(let radius=40;radius<=240&&!blocked;radius+=20)for(let angle=0;angle<16&&!blocked;angle++){
      const p={x:sender.position.x+Math.cos(angle*Math.PI/8)*radius,y:sender.position.y+Math.sin(angle*Math.PI/8)*radius};
      if(!geometry.canOccupy(p.x,p.y)||geometry.lineOfSight(p,sender.position))continue;
      const copy=structuredClone(listener);copy.position=p;
      const observationState={...state,agents:state.agents.map(n=>n===listener?copy:n)};
      bindOzarkWorldAgent(copy,geometry,observationState);
      const observed=observeIndication(copy,sender,observationState);require(observed.objectId===null,'Occluded observer acquired a referent');
      blocked={position:p,reason:observed.reason};
    }
    checks.occlusion={tested:!!blocked,scope:'Read-only observer copy using authoritative world LOS; no main actor relocation',...(blocked||{reason:'No occluded occupiable position in bounded local search'})};
    return status();
  }
  function completeIndication(){
    require(phase==='indicating','Expected indication');until(()=>sender.active!==indicationActive,'Sender indication did not finish');
    indicationProof=successfulDiscoveryActionCompletion(sender,indicationActive);
    require(indicationProof?.type==='indicate_object','No canonical successful sender indication');
    near(indicationProof.worked,1.8,'Paid sender work');near(state.elapsed-baseline.at,1.8,'Real main indication duration');
    require(!pose(),'Completion must remove public cue');
    const snapshot=noUpdates();require(snapshot.observed===1&&snapshot.pending===0&&snapshot.latest.status==='observed','Actual attachment did not observe completed demonstration');
    require(snapshot.latest.observedSeconds>=.5-1e-8,'Final consecutive paid perception was insufficient');
    require(audit.length>=100,'Missing repeated actual fixed-step listener perception');
    for(let i=1;i<audit.length;i++)near(audit[i].at-audit[i-1].at,fixedStep,'Consecutive listener perceptions');
    const expectedEffort=npcEffortCost(1.8,.25),metabolized=sender.physiology.totals.metabolizedKcal-baseline.metabolized;
    require(expectedEffort>0&&metabolized>=expectedEffort-1e-8,'Canonical paid work must have actual metabolic debit');
    require(JSON.stringify(sender.inventory)===JSON.stringify(baseline.inventory)&&sender.discovery.experiments.length===baseline.experiments,'Indication fabricated acquisition or experiment');
    checks.payment={canonicalWorkSeconds:indicationProof.worked,expectedActionEffortKcal:expectedEffort,totalMetabolizedKcal:metabolized,
      availableEnergyChange:sender.physiology.availableEnergyKcal-baseline.available,includesOrdinaryMetabolism:true};
    checks.sameMainPopulation=true;checks.actualFixedStep=1/60;checks.noAssociationUpdates=true;
    phase='completed';return status();
  }
  function pendingForSave(){
    require(phase==='completed','Complete primary reference before interruption fixture');
    const result=requestNpcAction(listener,{type:'inspect_object',targetId:privateTargetId},state.environment),active=listener.active;
    require(result.code==='ACTION_STARTED','Second deliberate inspect rejected');
    until(()=>listener.active!==active,'Second paid inspection did not finish');
    require(successfulDiscoveryActionCompletion(listener,active),'Second inspection lacks canonical proof');
    pendingPermit=createIndicationPermit(sender,listener,active,privateTargetId);require(pendingPermit,'Second paid inspect did not authorize canonical indication');
    require(requestNpcIndication(sender,pendingPermit,state.environment).code==='ACTION_STARTED','Second canonical indication rejected');
    pendingActive=sender.active;for(let i=0;i<12;i++)tick();require(pose(),'Pending saved cue did not become paid/visible');
    phase='pending-save';return status();
  }
  function checkpoint(storage){
    require(phase==='pending-save','Expected paid live indication at save');
    if(!saveCheckpoint())return null;
    const raw=storage.getItem(OZARK_SAVE_KEY);require(raw,'Main save did not write current bytes');
    const loaded=loadOzarkSave({getItem:key=>key===OZARK_SAVE_KEY?raw:null},geometry);
    require(!loaded.blocked,'Canonical save failed strict reload');
    const result={raw,expectedRestored:projectEvidence(loaded.state),report:status(),serializedActive:structuredClone(pendingActive),serializedPermit:{...pendingPermit},
      fixtureDisclosure:'Fresh default main state/population and original positions, deliberate optional listener inspect then post-choice sender indication. The ordinary main engine integrates environment/ecology/bodies at 1/60 second. Bounded decision scheduling only; no body hold, injected crops, association updates, reward, cohort, scientific-seed sweep or autonomous-adoption claim. Second canonical paid sequence is saved mid-cue to test reopen interruption.'};
    for(let i=0;i<state.agents.length;i++)require(JSON.stringify(state.agents[i].position)===JSON.stringify(initialPositions[i]),'Fixture moved an actor');
    return result;
  }
  function interrupt(){
    require(phase==='pending-save','Expected pending cue');const paid=discoveryActionPaidSeconds(sender,pendingActive);
    cancelNpcAction(sender,'NATIVE_FIXTURE_INTERRUPTION');require(!pose()&&!successfulDiscoveryActionCompletion(sender,pendingActive),'Interruption fabricated completion or retained cue');
    checks.interruption={paidSeconds:paid,result:structuredClone(sender.lastResult),poseCleared:true};
    require(paid>0&&paid<1.8,'Interruption must retain genuine partial paid work');phase='interrupted';return status();
  }
  return {project,status,beginChoice,completeChoice,beginIndication,visible,completeIndication,pendingForSave,checkpoint,interrupt,
    dispose(){sensor.dispose?.();}};
}

/** Read-only replay attempts on copies of the actual independently reopened
 * application's actors. They cannot alter the actual loaded main population. */
export async function probeVisualReferenceReopen(moduleBase,state,serializedActive,serializedPermit) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {createIndicationPermit,publicIndicationGeometry,successfulDiscoveryActionCompletion}=await use('discovery-actions');
  const {requestNpcIndication,observeNpc}=await use('npc');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {bindOzarkEcology}=await use('ozark-ecology');
  const geometry=createOzarkWorldGeometry(),[sender,listener]=state.agents;
  if(state.agents.some(n=>n.active))throw new Error('Actual reopened snapshot retained an active command');
  // fullSnapshot/IPC cloning intentionally drops runtime-only WeakMap bindings.
  // Restore only physical geometry on this diagnostic copy before fresh sight;
  // action receipts, permits and actual-main authority remain untouched.
  bindOzarkEcology(state.environment.ecology,geometry);
  for(const n of state.agents){bindOzarkWorldAgent(n,geometry,state);observeNpc(n,state.environment);}
  sender.active=structuredClone(serializedActive);const copiedActivePose=publicIndicationGeometry(sender);sender.active=null;
  const result={copiedActivePose,pose:publicIndicationGeometry(sender),completion:successfulDiscoveryActionCompletion(sender,serializedActive),
    permit:createIndicationPermit(sender,listener,serializedActive,serializedActive.request.targetId),
    copiedPermitResult:requestNpcIndication(sender,serializedPermit,state.environment),active:sender.active};
  if(result.copiedActivePose||result.pose||result.completion||result.permit||result.copiedPermitResult.ok||result.active)throw new Error('Reopened data revived runtime indication authority');
  return {...result,noRevivedAuthority:true,scope:'Fresh sight on copies of actual reopened state; no second clock or actual-main mutation'};
}
