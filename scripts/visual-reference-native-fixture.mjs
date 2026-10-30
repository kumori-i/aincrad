/** Engineering-only, deliberate character-message exercise of the actual main state and
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
  const {observeNpc,requestNpcAction,cancelNpcAction}=await use('npc');
  const {publicIndicationGeometry,discoveryActionPaidSeconds,successfulDiscoveryActionCompletion,referenceGeometry}=await use('discovery-actions');
  const {observeIndication,senseReferenceObjects,resolveIndication,visibleIndicationGeometry}=await use('visual-reference-perception');
  const {actorLineOfSight}=await use('perception');
  const {createCommunicationPixelSensor,poolCommunicationPixels}=await use('communication-pixels');
  const {npcEffortCost}=await use('npc-effort-funding');
  const {classifyOwnDemonstration,listenerDistribution}=await use('character-message-core');
  const {validateCharacterPersistence}=await use('visual-reference-save');
  const {loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {state,populationState,reference,geometry,renderer,step,fixedStep,checkpoint:saveCheckpoint}=context;
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const near=(a,b,label)=>require(Math.abs(a-b)<1e-7,`${label}: ${a} != ${b}`);
  require(state===populationState&&state.elapsed===0&&state.agents.length===2,'Expected fresh actual main state/population');
  near(fixedStep,1/60,'Actual main fixed step');
  require(reference?.snapshot().phase==='private-character-message','Expected actual private character-message attachment');
  const [sender,listener]=state.agents;
  if(context.responseScenario===true){
    // Explicit engineering geometry, never an ordinary-world opportunity or
    // a runtime pair/target override. The unchanged default profile retains
    // both original actor positions.
    require(sender.id==='aster'&&listener.id==='mira'&&sender.position.x===276&&sender.position.y===760&&
      listener.position.x===300&&listener.position.y===920,'Authored response fixture requires exact fresh actors');
    require(geometry.canOccupy(230,960),'Authored listener position must be physically occupiable');
    listener.position.x=230;listener.position.y=960;
    require(actorLineOfSight(listener,listener.position,sender.position),'Authored response actors must see each other');
  }
  const initialPositions=state.agents.map(n=>({...n.position}));
  const sensor=context.auditSensor||createCommunicationPixelSensor(document);
  const actualCanvas=!context.auditSensor;
  const audit=[],responseAudit=[],steps=[],checks={};
  let choiceActive,indicationActive,responseActive,pendingActive,privateTargetId,choiceProof,indicationProof,baseline,responseBaseline;
  let secondStarted=false,secondChoiceActive=null,secondDemoActive=null;
  let phase='ready';
  const characterState=()=>reference.exportPersistence().characterMessages;
  const ownerState=id=>characterState().learners.find(row=>row.agentId===id);
  const partnerState=(ownerId,partnerId)=>ownerState(ownerId).partners.find(row=>row.agentId===partnerId).listener;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const beforeCharacters=structuredClone(characterState());
  const originalSender=beforeCharacters.learners.find(row=>row.agentId===sender.id).sender;
  const originalListener=beforeCharacters.learners.find(row=>row.agentId===listener.id).partners[0].listener;
  let admissionCrops=null;
  const holdUntil=state.elapsed+20;
  // Bounded deliberate command scheduling, NOT bodily holds: the same ordinary
  // population still integrates every environment, ecology and body fixed step.
  for(const n of state.agents){n.nextDecisionAt=holdUntil;observeNpc(n,state.environment);}
  if(context.responseScenario===true){
    const own=senseReferenceObjects(listener,state),other=senseReferenceObjects(sender,state);
    require(own.complete&&other.complete,'Authored response geometry requires complete original sight');
    let forward=0;
    for(let i=0;i<own.objects.length;i++){
      const id=own.bindings[i],j=other.bindings.indexOf(id);if(j<0)continue;
      const position=own.objects[i].position,cue=referenceGeometry(sender.position,position,sender.scene,1);
      if(!cue||!visibleIndicationGeometry(listener,cue)||resolveIndication(cue,own.objects).index!==i)continue;
      forward++;
      const reply=referenceGeometry(listener.position,position,listener.scene,1);
      require(reply&&visibleIndicationGeometry(sender,reply)&&resolveIndication(reply,other.objects).index===j,
        'Every authored forward candidate must admit an independent visible reply');
    }
    require(forward>=2,'Authored response geometry needs at least two original candidates');
    checks.authoredGeometry={scope:'engineering-only fresh-profile placement; no ordinary-world opportunity claim',
      senderOriginal:{x:276,y:760},listenerOriginal:{x:300,y:920},listenerPlaced:{x:230,y:960},
      forwardAndReverseCandidateCount:forward,peerDistance:Math.hypot(listener.position.x-sender.position.x,listener.position.y-sender.position.y)};
  }
  if(renderer){renderer.followNpc=true;renderer.followId=sender.id;renderer.targetZoom=2;renderer.snap(sender.position);}
  const project=()=>projectEvidence(state);
  const pose=()=>publicIndicationGeometry(sender);
  const responsePose=()=>publicIndicationGeometry(listener);
  const associationState=()=>{
    const s=reference.snapshot(),completed=!!successfulDiscoveryActionCompletion(sender,indicationActive),expected=completed?1:0;
    require(s.positive===0&&s.negative===0&&s.relief===0&&s.discomfort===0,'Character learning cannot pay a bodily reward');
    require(s.observationEvents.every(e=>e.reward===null),'No reference reward');
    require(s.learners.length===2,'Expected the same two private main-world memories');
    const own=s.learners.find(n=>n.agentId===listener.id);
    const bank=own.character?.partnerBanks?.find(row=>row.partnerId===sender.id);
    if(!secondStarted)require(own.character?.listenerUpdates===expected&&
      own.character?.uniqueDemonstrations===expected&&bank?.retainedExamples===expected&&
      own.counts.entries===0&&own.counts.examples===0,
      'Exactly one numeric listener example may appear only after canonical paid indication completion; legacy memory stays archival');
    else require(own.character?.listenerUpdates>=1&&own.character?.uniqueDemonstrations>=1&&bank?.retainedExamples>=1,
      'A second transaction cannot erase the already earned listener example');
    require(Array.isArray(s.senderFeedback)&&s.senderFeedback.length===0,
      'Character messages must never expose a replayable sender feedback queue');
    return s;
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
    const response=responsePose();
    if(response){
      require(Object.keys(response).sort().join(',')==='origin,progress,scene,tip','Listener response geometry leaks target metadata');
      near(Math.hypot(response.tip.x-response.origin.x,response.tip.y-response.origin.y),24,'Fixed listener response segment');
      const sensed=senseReferenceObjects(sender,state),numeric=resolveIndication(response,sensed.objects),seen=observeIndication(sender,listener,state);
      const resolved=sensed.complete&&seen.reason==='resolved'&&numeric.index===seen.index&&
        sensed.bindings[numeric.index]===seen.objectId&&seen.objectId===responseActive.request.targetId;
      require(context.responseScenario!==true||resolved,'Authored response failed current visible correspondence');
      const crop=resolved?sensor.capture(sender,state).get(seen.objectId):null;
      require(context.responseScenario!==true||crop?.pixels?.length===768&&crop.features?.length===48,
        'Authored response lacks a fresh sender crop');
      responseAudit.push({at:state.elapsed,senderAt:sender.elapsed,geometry:response,numericInput:sensed.objects,numericResult:numeric,
        localBinding:seen.objectId??null,reason:resolved?'resolved':seen.reason==='resolved'?'binding-mismatch':seen.reason,
        paidSeconds:discoveryActionPaidSeconds(listener,listener.active),
        senderFeatures:crop?.features?.slice()??null});
    }
    associationState();
  };
  const until=(condition,label,max=180)=>{for(let i=0;!condition()&&i<max;i++)tick();require(condition(),label);};
  const status=()=>({phase,elapsed:state.elapsed,pose:pose(),responsePose:responsePose(),reference:associationState(),privateWitness:{targetId:privateTargetId??null,
    choice:choiceProof??null,indication:indicationProof??null,responseTargetId:responseActive?.request?.targetId??null},
    audit:structuredClone(audit),responseAudit:structuredClone(responseAudit),steps:structuredClone(steps),checks:{...checks}});
  function beginChoice(){
    require(phase==='ready'&&!pose(),'Before choice there must be no paid cue');
    const action=reference.hooks.optionalAction(listener);
    require(action?.type==='inspect_object','Initial real Canvas observations did not admit a distinguishable pair');
    admissionCrops=sensor.capture(listener,state);
    const result=requestNpcAction(listener,action,state.environment);choiceActive=listener.active;
    reference.hooks.performed(listener,action,result,choiceActive);
    require(result.code==='ACTION_STARTED'&&choiceActive,'Deliberate listener inspect did not start');
    require(!pose(),'An unfinished listener choice cannot produce a cue');
    const event=reference.snapshot().latest,senderPolicy=ownerState(sender.id).sender,
      listenerPolicy=partnerState(listener.id,sender.id);
    require(event.choiceMode==='uniform-untrained'&&/^[a-z]{1,6}$/.test(event.message),
      'Actual first policy action must use an emitted character string and untrained uniform listener choice');
    require(senderPolicy.emissions===1&&senderPolicy.updates===0&&same(senderPolicy.model,originalSender.model)&&
      listenerPolicy.demonstrations===0&&listenerPolicy.optimizerSteps===0&&
      same(listenerPolicy.model,originalListener.model),
      'Emitting a message and choosing a candidate cannot train either policy');
    checks.preDemonstration={receiverExamples:0,choiceMode:'uniform-untrained',message:event.message,
      eligibleDistribution:[.5,.5],senderEmissions:1,senderWeightsUnchanged:true,listenerWeightsUnchanged:true};
    phase='choice';return status();
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
    const snapshot=associationState();
    const replyAvailable=snapshot.pending===1&&snapshot.latest.feedbackStatus==='awaiting-response';
    const replyCensored=snapshot.pending===0&&snapshot.latest.feedbackStatus==='censored';
    require(snapshot.observed===1&&snapshot.latest.status==='observed'&&
      (context.responseScenario===true?replyAvailable:replyAvailable||replyCensored),
    'Actual attachment lost the paid character demonstration or an eligible optional reply');
    checks.replyAvailable=replyAvailable;
    if(replyCensored)checks.replyCensorReason=snapshot.latest.feedbackReason;
    require(snapshot.senderFeedback.length===0,'Sender cannot receive feedback before a listener response');
    require(snapshot.latest.observedSeconds>=.5-1e-8,'Final consecutive paid perception was insufficient');
    require(audit.length>=100,'Missing repeated actual fixed-step listener perception');
    for(let i=1;i<audit.length;i++)near(audit[i].at-audit[i-1].at,fixedStep,'Consecutive listener perceptions');
    const expectedEffort=npcEffortCost(1.8,.25),metabolized=sender.physiology.totals.metabolizedKcal-baseline.metabolized;
    require(expectedEffort>0&&metabolized>=expectedEffort-1e-8,'Canonical paid work must have actual metabolic debit');
    require(JSON.stringify(sender.inventory)===JSON.stringify(baseline.inventory)&&sender.discovery.experiments.length===baseline.experiments,'Indication fabricated acquisition or experiment');
    checks.payment={canonicalWorkSeconds:indicationProof.worked,expectedActionEffortKcal:expectedEffort,totalMetabolizedKcal:metabolized,
      availableEnergyChange:sender.physiology.availableEnergyKcal-baseline.available,includesOrdinaryMetabolism:true};
    const own=snapshot.learners.find(n=>n.agentId===listener.id),policy=partnerState(listener.id,sender.id),
      senderPolicy=ownerState(sender.id).sender,entry=policy.examples[0];
    const finalOwnFeatures=poolCommunicationPixels(snapshot.latest.demonstrationPixels);
    const currentOwn=sensor.capture(listener,state).get(privateTargetId);
    require(currentOwn?.pixels?.length===768&&same(currentOwn.features,finalOwnFeatures),
      'The completed own demonstration must still be an actual current Canvas crop');
    require(entry?.message===snapshot.latest.message&&entry.candidates?.length===2&&
      entry.label===classifyOwnDemonstration(entry.candidates,finalOwnFeatures)&&
      [0,1].includes(entry.label)&&snapshot.latest.listenerUpdate===true,
      'The numeric listener label must use exactly the received string, original own candidate views and final own crop');
    const admitted=[...admissionCrops.values()].map(crop=>crop.features);
    require(entry.candidates.every(candidate=>admitted.some(view=>same(view,candidate))),
      'Both retained candidate vectors must come from actual original listener Canvas crops');
    require(policy.demonstrations===1&&policy.replayUses===0&&policy.optimizerSteps===1&&
      own.character.uniqueDemonstrations===1&&own.character.listenerUpdates===1&&
      !same(policy.model,originalListener.model)&&same(senderPolicy.model,originalSender.model)&&
      senderPolicy.updates===0,
      'Exactly one completed demonstration updates only the private listener model before any reply');
    const modelDistribution=listenerDistribution(policy.model,entry.message,entry.candidates,{hasDemonstration:true});
    require(modelDistribution.probabilities.length===2&&modelDistribution.probabilities.every(Number.isFinite),
      'Trained listener distribution must be finite on its actual own-view example');
    checks.listenerLearning={uniqueDemonstrations:1,replayUses:0,optimizerSteps:1,retainedExamples:1,
      message:entry.message,label:entry.label,finalOwnFeatures,actualCanvas,
      candidateViewsFromOriginalCanvas:true,senderWeightsUnchangedBeforeResponse:true,
      provenance:'Original own candidate Canvas crops and final personally observed demonstration crop; one canonical paid completion'};
    checks.sameMainPopulation=true;checks.actualFixedStep=1/60;checks.canonicalOwnDemonstrationOnly=true;
    phase=replyAvailable?'indication-complete':'completed';return status();
  }
  function beginResponse(){
    require(phase==='indication-complete'&&!pose()&&!responsePose(),'Expected learned demonstration and no unpaid response cue');
    const action=reference.hooks.optionalAction(listener);
    require(action?.type==='indicate_object','No optional post-inspection listener response');
    const result=reference.hooks.performOptional(listener,action);responseActive=listener.active;
    require(result?.code==='ACTION_STARTED'&&responseActive,'Canonical paid listener response did not start');
    require(responseActive.request.targetId===choiceActive.request.targetId,'Listener response must indicate its own inspected referent');
    require(!responsePose()&&reference.snapshot().senderFeedback.length===0,'Unfunded response cannot publish geometry or feedback');
    responseBaseline={at:state.elapsed,metabolized:listener.physiology.totals.metabolizedKcal,
      available:listener.physiology.availableEnergyKcal,inventory:structuredClone(listener.inventory),
      experiments:listener.discovery.experiments.length};
    phase='responding';return status();
  }
  function visibleResponse(){
    require(phase==='responding','Expected paid listener response');for(let i=0;i<24;i++)tick();
    require(responsePose()&&responseAudit.length>=23,'No sustained paid public listener response');
    const id=responseActive.request.targetId,senderCrop=sensor.capture(sender,state).get(id),listenerCrop=sensor.capture(listener,state).get(id);
    const g=responsePose(),sensed=senseReferenceObjects(sender,state),index=sensed.bindings.indexOf(id);
    const resolved=index>=0&&resolveIndication(g,sensed.objects).index===index;
    require(context.responseScenario!==true||resolved,'Authored response geometry must resolve in sender local sight');
    require(context.responseScenario!==true||senderCrop?.pixels?.length===768&&senderCrop.features?.length===48&&
      listenerCrop?.pixels?.length===768&&listenerCrop.features?.length===48,'Authored response needs current Canvas crops');
    const ambiguous=resolved?resolveIndication(g,[...sensed.objects,sensed.objects[index]]):null;
    if(resolved)require(ambiguous.reason==='ambiguous'&&ambiguous.index===null,'Competing sender-side geometry must fail closed');
    checks.responseVisible={actualCanvas,resolved,
      sender:senderCrop?{pixels:senderCrop.pixels.slice(),features:senderCrop.features.slice(),at:senderCrop.at,epoch:senderCrop.epoch}:null,
      listenerComparison:listenerCrop?{pixels:listenerCrop.pixels.slice(),features:listenerCrop.features.slice(),at:listenerCrop.at,epoch:listenerCrop.epoch}:null,
      numericAmbiguity:ambiguous,scope:'Only sender fresh crop may reach feedback; listener comparison is a private engineering audit'};
    require(reference.snapshot().senderFeedback.length===0,'Visible response cannot train before canonical paid completion');
    return status();
  }
  function completeResponse(){
    require(phase==='responding','Expected listener response');until(()=>listener.active!==responseActive,'Paid listener response did not finish');
    const proof=successfulDiscoveryActionCompletion(listener,responseActive);
    require(proof?.type==='indicate_object','No canonical successful listener response');near(proof.worked,1.8,'Paid listener response work');
    near(state.elapsed-responseBaseline.at,1.8,'Real main listener response duration');
    require(!pose()&&!responsePose(),'Completion must remove both public cues');
    const snapshot=associationState(),feedbackStatus=snapshot.latest.feedbackStatus;
    const sampled=feedbackStatus==='matched'||feedbackStatus==='mismatched';
    require(snapshot.observed===1&&snapshot.pending===0&&
      (context.responseScenario===true?sampled&&feedbackStatus==='mismatched':sampled||feedbackStatus==='censored'),
    'Completed response must yield a paid local sample or an explicit censored outcome');
    const finalSender=sensor.capture(sender,state).get(responseActive.request.targetId);
    const finalListener=sensor.capture(listener,state).get(responseActive.request.targetId);
    if(sampled){
      require(finalSender?.pixels?.length===768&&finalSender.features?.length===48&&finalListener?.features?.length===48,
        'Sampled response needs final fresh Canvas views');
      require(same(finalSender.features,poolCommunicationPixels(finalSender.pixels))&&
        finalSender.at<=sender.elapsed+1e-8&&sender.elapsed-finalSender.at<=fixedStep+1e-8,
        'Sender-local feedback must use the final fresh paid-step Canvas crop');
    }
    require(snapshot.senderFeedback.length===0,'Character training must not leave a replayable feedback queue');
    const intended=poolCommunicationPixels(snapshot.latest.senderPixels),localDistance=finalSender?.features?.length===48?
      Math.sqrt(intended.reduce((sum,value,index)=>sum+(value-finalSender.features[index])**2,0)/48):null;
    if(sampled)require(localDistance!==null&&
      (feedbackStatus==='matched'?localDistance<=.04:localDistance>=.08),
      'Recorded sender feedback must agree with sender-only actual Canvas RMS');
    const senderPolicy=ownerState(sender.id).sender,listenerPolicy=partnerState(listener.id,sender.id);
    if(sampled){
      require(snapshot.latest.senderUpdate===true&&senderPolicy.updates===1&&senderPolicy.revision===1&&
        senderPolicy.emissions===1&&!same(senderPolicy.model,originalSender.model)&&
        Math.abs(senderPolicy.baseline-(feedbackStatus==='matched'?.05:-.05))<1e-12,
        'One authentic paid sender-local outcome must update only its original on-policy sender once');
    }else require(snapshot.latest.senderUpdate!==true&&senderPolicy.updates===0&&
      senderPolicy.baseline===0&&same(senderPolicy.model,originalSender.model),
      'A censored response must leave sender weights and baseline exact');
    require(listenerPolicy.demonstrations===1&&listenerPolicy.optimizerSteps===1,
      'The later reply cannot revoke or duplicate completed listener learning');
    require(responseAudit.length>=100,'Missing repeated sender-side response perception');
    for(let i=1;i<responseAudit.length;i++)near(responseAudit[i].at-responseAudit[i-1].at,fixedStep,'Consecutive sender response perceptions');
    const expectedEffort=npcEffortCost(1.8,.25),metabolized=listener.physiology.totals.metabolizedKcal-responseBaseline.metabolized;
    require(expectedEffort>0&&metabolized>=expectedEffort-1e-8,'Listener response must have canonical metabolic debit');
    require(JSON.stringify(listener.inventory)===JSON.stringify(responseBaseline.inventory)&&
      listener.discovery.experiments.length===responseBaseline.experiments,'Response fabricated acquisition or experiment');
    checks.responsePayment={canonicalWorkSeconds:proof.worked,expectedActionEffortKcal:expectedEffort,
      totalMetabolizedKcal:metabolized,availableEnergyChange:listener.physiology.availableEnergyKcal-responseBaseline.available,
      includesOrdinaryMetabolism:true};
    if(sampled)checks.senderFeedback={signal:feedbackStatus==='matched'?'match':'mismatch',
      localDistance,actualCanvas,senderObservedFeatures:finalSender.features.slice(),
      senderCurrentFeatures:finalSender.features.slice(),
      listenerComparisonFeatures:finalListener.features.slice(),senderOnly:true,
      interpretation:'One sender-local visible-crop similarity signal from a completed paid listener gesture; no hidden correctness or bodily reward'};
    else checks.responseCensorReason=snapshot.latest.feedbackReason;
    checks.senderLearning={updated:sampled,updates:senderPolicy.updates,baseline:senderPolicy.baseline,
      changedParameters:!same(senderPolicy.model,originalSender.model),
      listenerLearningRetained:listenerPolicy.optimizerSteps===1,
      feedbackStatus,scope:'Only canonical sender-local fresh Canvas feedback can update the frozen sampled trajectory'};
    phase='completed';return status();
  }
  function inspectAssociation(){
    require(phase==='completed'&&!checks.modelAudit,'Audit exactly one completed real sequence');
    const beforeWorld=JSON.stringify(project()),beforeReference=JSON.stringify(reference.snapshot()),
      beforeCharacter=JSON.stringify(characterState());
    const policy=partnerState(listener.id,sender.id),example=policy.examples[0];
    require(example?.message===checks.listenerLearning.message,'The read-only policy query uses the actual retained sequence');
    const candidateViews=example.candidates.map(features=>{
      const crop=[...admissionCrops.values()].find(view=>same(view.features,features));
      require(crop?.pixels?.length===768&&crop.features?.length===48,'Query candidates must have actual original Canvas crops');
      require(same(poolCommunicationPixels(crop.pixels),features),'Query features must equal pixels from original listener Canvas');
      return {at:crop.at,features:crop.features.slice(),pixels:crop.pixels.slice()};
    });
    const known=listenerDistribution(policy.model,example.message,example.candidates,{hasDemonstration:true});
    const reversed=listenerDistribution(policy.model,example.message,example.candidates.slice().reverse(),{hasDemonstration:true});
    const untrained=listenerDistribution(policy.model,example.message,example.candidates,{hasDemonstration:false});
    for(let index=0;index<2;index++)near(known.probabilities[index],reversed.probabilities[1-index],
      'Candidate-order-equivariant listener distribution');
    require(same(untrained.probabilities,[.5,.5]),'Untrained gate must remain exactly uniform');
    require(JSON.stringify(project())===beforeWorld&&JSON.stringify(reference.snapshot())===beforeReference&&
      JSON.stringify(characterState())===beforeCharacter,
      'Read-only numeric query changed main state, private weights, RNG or transaction metrics');
    checks.modelAudit={message:example.message,label:example.label,candidateViews,
      ownDemonstrationFeatures:checks.listenerLearning.finalOwnFeatures,
      known,reversed,untrained,readOnly:true,
      interpretation:'Current private numeric model on original own Canvas candidates; scores do not establish word meaning, later policy success or generalization'};
    return status();
  }
  function pendingForSave(){
    require(phase==='completed'&&checks.modelAudit,'Complete primary sequence and read-only audit before interruption fixture');
    secondStarted=true;
    while(state.elapsed<12.1-1e-8)tick();
    const choice=reference.hooks.optionalAction(listener);
    require(choice?.type==='inspect_object','Second optional listener choice unavailable after cooldown');
    const started=requestNpcAction(listener,choice,state.environment);secondChoiceActive=listener.active;
    reference.hooks.performed(listener,choice,started,secondChoiceActive);
    require(started?.code==='ACTION_STARTED'&&secondChoiceActive,'Second canonical inspect did not start');
    until(()=>listener.active!==secondChoiceActive,'Second paid listener inspection did not finish');
    const inspected=successfulDiscoveryActionCompletion(listener,secondChoiceActive);
    require(inspected?.type==='inspect_object'&&inspected.targetId===choice.targetId,'Second inspection has no original paid selection proof');
    const demonstration=reference.hooks.optionalAction(sender);
    require(demonstration?.type==='indicate_object','Second sender demonstration unavailable');
    require(reference.hooks.performOptional(sender,demonstration)?.code==='ACTION_STARTED','Second paid sender demonstration did not start');
    secondDemoActive=sender.active;pendingActive=secondDemoActive;privateTargetId=secondDemoActive.request.targetId;
    for(let i=0;i<12;i++)tick();
    const pending=reference.snapshot();
    require(pose()&&pending.pending===1&&pending.latest.status==='indicating'&&
      pending.latest.message&&pending.latest.listenerUpdate!==true&&pending.latest.senderUpdate!==true,
      'A partly paid second sequence must preserve its private pending trajectory without training');
    checks.pendingSenderMessage={message:pending.latest.message,paidSeconds:discoveryActionPaidSeconds(sender,pendingActive),
      pending:pending.pending,listenerUpdate:false,senderUpdate:false};
    phase='pending-save';return status();
  }
  function pendingResponseForSave(){
    require(phase==='completed'&&checks.modelAudit,'Complete and audit the first sequence before the response lifecycle fixture');
    require(ownerState(sender.id).sender.updates===1&&reference.snapshot().senderFeedback.length===0,
      'The first completed paid response must update the private sender once without a replayable queue');
    secondStarted=true;
    while(state.elapsed<12.1-1e-8)tick();
    const choice=reference.hooks.optionalAction(listener);
    require(choice?.type==='inspect_object','Second optional listener choice unavailable after cooldown');
    const started=requestNpcAction(listener,choice,state.environment);secondChoiceActive=listener.active;
    reference.hooks.performed(listener,choice,started,secondChoiceActive);
    require(started?.code==='ACTION_STARTED'&&secondChoiceActive,'Second canonical inspect did not start');
    until(()=>listener.active!==secondChoiceActive,'Second paid listener inspection did not finish');
    const inspected=successfulDiscoveryActionCompletion(listener,secondChoiceActive);
    require(inspected?.type==='inspect_object'&&inspected.targetId===choice.targetId,'Second inspection has no original paid selection proof');
    near(inspected.worked,secondChoiceActive.seconds,'Second paid inspect work');
    const demonstration=reference.hooks.optionalAction(sender);
    require(demonstration?.type==='indicate_object','Second sender demonstration unavailable');
    require(reference.hooks.performOptional(sender,demonstration)?.code==='ACTION_STARTED','Second paid sender demonstration did not start');
    secondDemoActive=sender.active;privateTargetId=secondDemoActive.request.targetId;
    until(()=>sender.active!==secondDemoActive,'Second sender demonstration did not finish');
    const demonstrated=successfulDiscoveryActionCompletion(sender,secondDemoActive);
    require(demonstrated?.type==='indicate_object','Second sender demonstration has no successful paid proof');
    near(demonstrated.worked,1.8,'Second sender demonstration work');
    require(reference.snapshot().latest.feedbackStatus==='awaiting-response'&&reference.snapshot().pending===1,
      'Second completed demonstration must leave an optional listener response pending');
    const reply=reference.hooks.optionalAction(listener);
    require(reply?.type==='indicate_object','Second optional listener response unavailable');
    require(reference.hooks.performOptional(listener,reply)?.code==='ACTION_STARTED','Second paid listener response did not start');
    responseActive=listener.active;pendingActive=responseActive;
    require(responseActive.request.targetId===secondChoiceActive.request.targetId,
      'Pending response must retain the second original completed inspection choice');
    require(!responsePose(),'Unpaid second response cannot publish a pose');
    for(let i=0;i<12;i++)tick();
    const pending=reference.snapshot();
    require(responsePose()&&pending.pending===1&&pending.latest.feedbackStatus==='responding'&&
      pending.senderFeedback.length===0&&ownerState(sender.id).sender.updates===1,
      'Partly paid response must remain visible and supply no second sender update');
    checks.pendingResponse={originalInspectedId:secondChoiceActive.request.targetId,
      demonstrationId:secondDemoActive.request.targetId,paidSeconds:discoveryActionPaidSeconds(listener,pendingActive),
      firstSenderUpdates:ownerState(sender.id).sender.updates,pending:pending.pending,
      feedbackStatus:pending.latest.feedbackStatus};
    require(checks.pendingResponse.paidSeconds>0&&checks.pendingResponse.paidSeconds<1.8,
      'Saved response must have genuine partial paid work');
    phase='pending-response-save';return status();
  }
  function checkpoint(storage){
    require(['pending-save','pending-response-save'].includes(phase),'Expected paid live indication at save');
    const before=JSON.stringify(reference.snapshot()),persisted=reference.exportPersistence(),
      beforeCharacter=JSON.stringify(persisted.characterMessages);
    require(JSON.stringify(reference.snapshot())===before&&JSON.stringify(characterState())===beforeCharacter,
      'Persistence export changed private weights, random states or pending metrics');
    if(!saveCheckpoint())return null;
    const raw=storage.getItem(OZARK_SAVE_KEY);require(raw,'Main save did not write current bytes');
    const document=JSON.parse(raw),canonical=validateCharacterPersistence(persisted);
    require(JSON.stringify(document.worldLineage)===JSON.stringify(canonical.worldLineage)&&
      JSON.stringify(document.visualReference)===JSON.stringify(canonical.visualReference)&&
      JSON.stringify(document.characterMessages)===JSON.stringify(canonical.characterMessages),
    'Canonical checkpoint omitted or changed the pure private character-message export');
    require(JSON.stringify(reference.snapshot())===before&&JSON.stringify(characterState())===beforeCharacter,
      'Save changed private weights, random states or pending metrics');
    const loaded=loadOzarkSave({getItem:key=>key===OZARK_SAVE_KEY?raw:null},geometry);
    require(!loaded.blocked,'Canonical save failed strict reload');
    const responseCase=phase==='pending-response-save';
    const result={raw,expectedRestored:projectEvidence(loaded.state),report:status(),serializedActive:structuredClone(pendingActive),
      serializedInspectionActive:structuredClone(secondChoiceActive),
      serializedPermit:{},serializedDemonstrationActive:responseCase?structuredClone(secondDemoActive):null,
      pendingKind:responseCase?'listener-response':'sender-demonstration',
      fixtureDisclosure:responseCase?
        'Fresh disposable main-world character-message negative control with fixed historical communication seed 212 and explicitly authored Mira position (230,960), moved from (300,920) before any action. Aster remains at (276,760); ecology, bodies and resources are unchanged. This engineering geometry makes forward and reverse gestures numerically resolvable under the ordinary parser; it is not ordinary opportunity evidence, a favorable runtime redraw, or a scientific seed search. Separate predeclared target, order and uniform listener-choice draws yield a wrong original inspection. Actual Canvas views, canonical paid inspection, one listener model update, a paid listener response and one sender-local mismatch update are checked. A second optional sequence is saved and closed during its genuinely paid listener response; no duplicate feedback is granted. The main environment, ecology and bodies continue at 1/60 second with only bounded decision scheduling.':
        'Fresh default main state/population and original positions, deliberate optional listener inspect and paid post-choice sender indication with an actual sampled character string. The later optional reply is attempted only if independently resolvable; an unavailable reply censors sender feedback without erasing listener learning. The ordinary main engine integrates environment/ecology/bodies at 1/60 second. Bounded decision scheduling only; no body hold, injected crops, reward, cohort, scientific-seed sweep or autonomous-adoption claim. A read-only numeric model query uses the original actual own Canvas views but is not a policy action or generalization claim. A second authentic sampled sequence is saved mid-cue to test pending trajectory interruption on reopen.'};
    for(let i=0;i<state.agents.length;i++)require(JSON.stringify(state.agents[i].position)===JSON.stringify(initialPositions[i]),'Fixture moved an actor');
    return result;
  }
  function interrupt(){
    require(['pending-save','pending-response-save'].includes(phase),'Expected pending cue');
    const responseCase=phase==='pending-response-save',actor=responseCase?listener:sender;
    const beforeCharacter=JSON.stringify(characterState());
    const paid=discoveryActionPaidSeconds(actor,pendingActive);
    cancelNpcAction(actor,'NATIVE_FIXTURE_INTERRUPTION');
    require(!(responseCase?responsePose():pose())&&!successfulDiscoveryActionCompletion(actor,pendingActive),
      'Interruption fabricated completion or retained cue');
    reference.afterTick();
    require(JSON.stringify(characterState())===beforeCharacter,
      'Interrupting a pending paid sequence must not update weights, baseline or random states');
    if(responseCase)require(reference.snapshot().latest.feedbackStatus==='censored'&&reference.snapshot().senderFeedback.length===0,
      'Interrupted pending response cannot gain a second feedback event');
    checks.interruption={paidSeconds:paid,result:structuredClone(actor.lastResult),poseCleared:true,
      pendingKind:responseCase?'listener-response':'sender-demonstration'};
    require(paid>0&&paid<1.8,'Interruption must retain genuine partial paid work');phase='interrupted';return status();
  }
  return {project,status,beginChoice,completeChoice,beginIndication,visible,completeIndication,beginResponse,visibleResponse,completeResponse,
    inspectAssociation,pendingForSave,pendingResponseForSave,checkpoint,interrupt,
    characterExport:()=>structuredClone(characterState()),
    dispose(){sensor.dispose?.();}};
}

/** Read-only replay attempts on copies of the actual independently reopened
 * application's actors. They cannot alter the actual loaded main population. */
export async function probeVisualReferenceReopen(moduleBase,state,serializedActive,serializedPermit,
  {pendingKind='sender-demonstration',serializedInspectionActive=null,serializedDemonstrationActive=null}={}) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {createIndicationPermit,createListenerResponsePermit,publicIndicationGeometry,successfulDiscoveryActionCompletion}=await use('discovery-actions');
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
  const responseCase=pendingKind==='listener-response';
  if(!responseCase&&pendingKind!=='sender-demonstration')throw new Error('Unknown pending native fixture authority');
  if(serializedInspectionActive?.request?.type!=='inspect_object'||
      serializedInspectionActive.request.targetId==null)
    throw new Error('Missing copied original paid inspection receipt');
  const actor=responseCase?listener:sender;
  actor.active=structuredClone(serializedActive);const copiedActivePose=publicIndicationGeometry(actor);actor.active=null;
  const result={copiedActivePose,pose:publicIndicationGeometry(actor),completion:successfulDiscoveryActionCompletion(actor,serializedActive),
    inspectionCompletion:successfulDiscoveryActionCompletion(listener,serializedInspectionActive),
    inspectionPermit:createIndicationPermit(sender,listener,serializedInspectionActive,
      responseCase?serializedDemonstrationActive?.request?.targetId:serializedActive.request.targetId),
    responsePermit:responseCase?createListenerResponsePermit(listener,sender,serializedDemonstrationActive):null,
    copiedPermitResult:requestNpcIndication(actor,serializedPermit,state.environment),active:actor.active};
  if(result.copiedActivePose||result.pose||result.completion||result.inspectionCompletion||
      result.inspectionPermit||result.responsePermit||result.copiedPermitResult.ok||result.active)
    throw new Error('Reopened data revived runtime indication authority');
  return {...result,noRevivedAuthority:true,scope:'Fresh sight on copies of actual reopened state; no second clock or actual-main mutation'};
}
