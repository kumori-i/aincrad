/** Engineering-only, deliberate private-association exercise of the actual main state and
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
  const {createIndicationPermit,publicIndicationGeometry,discoveryActionPaidSeconds,successfulDiscoveryActionCompletion,referenceGeometry}=await use('discovery-actions');
  const {observeIndication,senseReferenceObjects,resolveIndication,visibleIndicationGeometry}=await use('visual-reference-perception');
  const {actorLineOfSight}=await use('perception');
  const {createCommunicationPixelSensor,poolCommunicationPixels}=await use('communication-pixels');
  const {npcEffortCost}=await use('npc-effort-funding');
  const {VISUAL_REFERENCE_MEMORY_LIMITS}=await use('visual-reference-memory');
  const {validateReferencePersistence}=await use('visual-reference-save');
  const {loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {state,populationState,reference,geometry,renderer,step,fixedStep,checkpoint:saveCheckpoint,auditAssociation}=context;
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const near=(a,b,label)=>require(Math.abs(a-b)<1e-7,`${label}: ${a} != ${b}`);
  require(state===populationState&&state.elapsed===0&&state.agents.length===2,'Expected fresh actual main state/population');
  near(fixedStep,1/60,'Actual main fixed step');
  require(reference?.snapshot().phase==='private-visual-association','Expected actual private-association attachment');
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
  let choiceActive,indicationActive,responseActive,pendingActive,pendingPermit,privateTargetId,choiceProof,indicationProof,baseline,responseBaseline;
  let secondStarted=false,secondChoiceActive=null,secondDemoActive=null;
  let phase='ready';
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
    require(s.positive===0&&s.negative===0&&s.relief===0&&s.discomfort===0,'Association evidence cannot pay a bodily reward');
    require(s.observationEvents.every(e=>e.reward===null),'No reference reward');
    require(s.learners.length===2,'Expected the same two private main-world memories');
    const own=s.learners.find(n=>n.agentId===listener.id);
    if(!secondStarted)require(s.updates===expected&&s.evidenceAdditions===expected&&s.correctionAttempts===expected&&
      s.supportUpdates===0&&s.conflicts===0&&own.counts.entries===expected&&own.counts.examples===expected,
      'Exactly one listener own-view exemplar may appear, only after canonical paid indication completion');
    else require(s.correctionAttempts>=1&&own.counts.examples>=1&&s.evidenceAdditions>=1,
      'A second transaction cannot erase the already earned listener example');
    require(Array.isArray(s.senderFeedback)&&s.senderFeedback.length<=1,'Sender feedback must be bounded and session-only');
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
    const result=requestNpcAction(listener,action,state.environment);choiceActive=listener.active;
    reference.hooks.performed(listener,action,result,choiceActive);
    require(result.code==='ACTION_STARTED'&&choiceActive,'Deliberate listener inspect did not start');
    require(!pose(),'An unfinished listener choice cannot produce a cue');
    require(reference.snapshot().latest.choiceMode==='uniform-exploration'&&reference.snapshot().latest.choiceReason==='unknown-symbol','Actual first policy action must use empty-memory uniform exploration');
    checks.preDemonstration={receiverExamples:0,choiceMode:'uniform-exploration',choiceReason:'unknown-symbol',eligibleDistribution:[.5,.5]};
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
    'Actual attachment lost the paid association or an eligible optional reply');
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
    const own=snapshot.learners.find(n=>n.agentId===listener.id),entry=own.partners[0]?.entries[0];
    const finalOwnFeatures=poolCommunicationPixels(snapshot.latest.demonstrationPixels);
    require(entry?.examples.length===1&&JSON.stringify(entry.examples[0])===JSON.stringify(finalOwnFeatures),'Stored exemplar must equal the listener final observed demonstration, not sender pixels');
    require(entry.symbol===snapshot.latest.tokens[0]*8+snapshot.latest.tokens[1]&&snapshot.latest.correction==='new-exemplar','Own exemplar must bind the actually received numeric symbol');
    checks.ownAssociation={evidenceAdditions:1,correctionAttempts:1,receiverExamples:1,symbol:entry.symbol,features:finalOwnFeatures,
      provenance:'listener final personally observed demonstration crop; one canonical completion'};
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
    const snapshot=associationState(),feedback=snapshot.senderFeedback[0],feedbackStatus=snapshot.latest.feedbackStatus;
    const sampled=feedback?.eventId===snapshot.latest.id&&
      ((feedback.signal==='match'&&feedbackStatus==='matched')||(feedback.signal==='mismatch'&&feedbackStatus==='mismatched'));
    require(snapshot.observed===1&&snapshot.pending===0&&
      (context.responseScenario===true?sampled&&feedbackStatus==='mismatched':sampled||feedbackStatus==='censored'),
    'Completed response must yield a paid local sample or an explicit censored outcome');
    const finalSender=sensor.capture(sender,state).get(responseActive.request.targetId);
    const finalListener=sensor.capture(listener,state).get(responseActive.request.targetId);
    if(sampled){
      require(finalSender?.pixels?.length===768&&finalSender.features?.length===48&&finalListener?.features?.length===48,
        'Sampled response needs final fresh Canvas views');
      require(JSON.stringify(feedback.features)===JSON.stringify(finalSender.features)&&
        JSON.stringify(feedback.features)===JSON.stringify(poolCommunicationPixels(finalSender.pixels)),
        'Feedback must contain the sender crop from the final paid response world state');
      require(feedback.at<=sender.elapsed+1e-8&&sender.elapsed-feedback.at<=fixedStep+1e-8,
        'Sender feedback must come from the final current paid step');
    }else require(snapshot.senderFeedback.length===0,'Censored reply cannot yield a sender training sample');
    require(responseAudit.length>=100,'Missing repeated sender-side response perception');
    for(let i=1;i<responseAudit.length;i++)near(responseAudit[i].at-responseAudit[i-1].at,fixedStep,'Consecutive sender response perceptions');
    const expectedEffort=npcEffortCost(1.8,.25),metabolized=listener.physiology.totals.metabolizedKcal-responseBaseline.metabolized;
    require(expectedEffort>0&&metabolized>=expectedEffort-1e-8,'Listener response must have canonical metabolic debit');
    require(JSON.stringify(listener.inventory)===JSON.stringify(responseBaseline.inventory)&&
      listener.discovery.experiments.length===responseBaseline.experiments,'Response fabricated acquisition or experiment');
    checks.responsePayment={canonicalWorkSeconds:proof.worked,expectedActionEffortKcal:expectedEffort,
      totalMetabolizedKcal:metabolized,availableEnergyChange:listener.physiology.availableEnergyKcal-responseBaseline.available,
      includesOrdinaryMetabolism:true};
    if(sampled)checks.senderFeedback={...feedback,actualCanvas,senderObservedFeatures:finalSender.features.slice(),
      senderCurrentFeatures:finalSender.features.slice(),
      listenerComparisonFeatures:finalListener.features.slice(),senderOnly:true,
      interpretation:'One sender-local visible-crop similarity signal from a completed paid listener gesture; no hidden correctness or bodily reward'};
    else checks.responseCensorReason=snapshot.latest.feedbackReason;
    phase='completed';return status();
  }
  function inspectAssociation(){
    require(phase==='completed'&&!checks.retrievalDiagnostic,'Audit exactly one completed real demonstration');
    const beforeWorld=JSON.stringify(project()),beforeReference=JSON.stringify(reference.snapshot());
    const evidence=auditAssociation();
    require(evidence?.viewSource==='fresh-listener-current-canvas','Missing one-shot actual-memory fresh-view diagnostic');
    require(evidence.eventId===reference.snapshot().latest.id&&evidence.symbol===checks.ownAssociation.symbol,'Diagnostic must use the first actual completed message');
    near(evidence.at,listener.elapsed,'Current diagnostic time');
    require(evidence.candidateViews?.length===2,'Expected same two current listener candidates');
    for(const view of evidence.candidateViews){
      near(view.at,listener.elapsed,'Fresh listener view time');
      require(view.pixels?.length===768&&view.features?.length===48,'Expected actual own Canvas view');
      require(JSON.stringify(view.features)===JSON.stringify(poolCommunicationPixels(view.pixels)),'Numeric audit features must come from copied own pixels');
    }
    require(JSON.stringify(evidence.demonstration.features)===JSON.stringify(checks.ownAssociation.features),'Audit must inspect actual acquired own evidence');
    require([0,1].includes(evidence.known.index)&&evidence.known.reason==='unique-match','Current same-view known message must uniquely retrieve acquired evidence');
    const distances=evidence.candidateViews.map(view=>Math.sqrt(view.features.reduce((sum,value,index)=>sum+(value-checks.ownAssociation.features[index])**2,0)/48));
    require(evidence.known.distances.length===2&&evidence.reversed.distances.length===2,'Actual memory must expose both candidate distances');
    for(let index=0;index<2;index++){near(evidence.known.distances[index],distances[index],'Actual-memory distance to the acquired own example');near(evidence.reversed.distances[1-index],distances[index],'Reversed actual-memory distance');}
    require(distances.filter(distance=>distance<=VISUAL_REFERENCE_MEMORY_LIMITS.match).length===1&&
      distances[evidence.known.index]<=VISUAL_REFERENCE_MEMORY_LIMITS.match&&
      distances[1-evidence.known.index]>=distances[evidence.known.index]+VISUAL_REFERENCE_MEMORY_LIMITS.margin,'Known-message eligibility must obey supplied match and margin, not hidden correctness');
    require(evidence.reversed.index===1-evidence.known.index&&evidence.reversed.reason==='unique-match','Reversed current candidates must reverse eligible index');
    require(evidence.absent&&evidence.absent.symbol!==evidence.symbol&&evidence.absent.choice.index===null&&evidence.absent.choice.reason==='unknown-symbol','Absent message must abstain from confident retrieval');
    const distributions={known:evidence.known.index===0?[1,0]:[0,1],absent:[.5,.5],reversed:evidence.reversed.index===0?[1,0]:[0,1]};
    require(auditAssociation()===null,'Diagnostic handle must be consumed, not a repeatable choice API');
    require(JSON.stringify(project())===beforeWorld&&JSON.stringify(reference.snapshot())===beforeReference,'Read-only retrieval diagnostic changed main state, histories, memory or transaction metrics');
    checks.retrievalDiagnostic={...evidence,eligibleDistributions:distributions,readOnly:true,
      interpretation:'Actual-memory same-scene fresh-view message-dependent retrieval eligibility only; no sampled or later policy action, vocabulary discrimination, generalization or survival benefit'};
    return status();
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
  function pendingResponseForSave(){
    require(phase==='completed'&&checks.retrievalDiagnostic,'Complete and audit the first reference before the response lifecycle fixture');
    require(reference.snapshot().senderFeedback.length===1,'The first completed response must have one ephemeral sample');
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
      pending.senderFeedback.length===1,'Partly paid response must remain visible and supply no second feedback');
    checks.pendingResponse={originalInspectedId:secondChoiceActive.request.targetId,
      demonstrationId:secondDemoActive.request.targetId,paidSeconds:discoveryActionPaidSeconds(listener,pendingActive),
      firstFeedbackCount:pending.senderFeedback.length,pending:pending.pending,
      feedbackStatus:pending.latest.feedbackStatus};
    require(checks.pendingResponse.paidSeconds>0&&checks.pendingResponse.paidSeconds<1.8,
      'Saved response must have genuine partial paid work');
    phase='pending-response-save';return status();
  }
  function checkpoint(storage){
    require(['pending-save','pending-response-save'].includes(phase),'Expected paid live indication at save');
    const before=JSON.stringify(reference.snapshot()),persisted=reference.exportPersistence();
    require(JSON.stringify(reference.snapshot())===before,'Persistence export changed private memory or pending metrics');
    if(!saveCheckpoint())return null;
    const raw=storage.getItem(OZARK_SAVE_KEY);require(raw,'Main save did not write current bytes');
    const document=JSON.parse(raw),canonical=validateReferencePersistence(persisted.worldLineage,persisted.visualReference);
    require(JSON.stringify(document.worldLineage)===JSON.stringify(canonical.worldLineage)&&
      JSON.stringify(document.visualReference)===JSON.stringify(canonical.visualReference),
    'Canonical checkpoint omitted or changed the pure private-memory export');
    require(JSON.stringify(reference.snapshot())===before,'Save changed private memory or pending metrics');
    const loaded=loadOzarkSave({getItem:key=>key===OZARK_SAVE_KEY?raw:null},geometry);
    require(!loaded.blocked,'Canonical save failed strict reload');
    const responseCase=phase==='pending-response-save';
    const result={raw,expectedRestored:projectEvidence(loaded.state),report:status(),serializedActive:structuredClone(pendingActive),
      serializedPermit:responseCase?{}:{...pendingPermit},serializedDemonstrationActive:responseCase?structuredClone(secondDemoActive):null,
      pendingKind:responseCase?'listener-response':'sender-demonstration',
      fixtureDisclosure:responseCase?
        'Fresh disposable main-world negative control with fixed communication seed 212 and explicitly authored Mira position (230,960), moved from (300,920) before any action. Aster remains at (276,760); ecology, bodies and resources are unchanged. This engineering geometry makes forward and reverse gestures numerically resolvable under the ordinary parser; it is not ordinary opportunity evidence, a favorable runtime redraw, or a scientific seed search. Independent target/order/exploration draws require a wrong original choice. Actual Canvas views, canonical paid inspection, sender correction and listener response show a sender-local mismatch after listener learning. A second optional full attachment transaction is saved and closed during its genuinely paid listener response; no second feedback is granted. The main environment, ecology and bodies continue at 1/60 second with only bounded decision scheduling.':
        'Fresh default main state/population and original positions, deliberate optional listener inspect and paid post-choice sender indication. The later optional reply is attempted only if independently resolvable; an unavailable reply censors feedback without erasing the acquired own-view association. The ordinary main engine integrates environment/ecology/bodies at 1/60 second. Bounded decision scheduling only; no body hold, injected crops, reward, cohort, scientific-seed sweep or autonomous-adoption claim. The one-shot message-dependence query uses actual memory and fresh own views but is not a policy action or generalization claim. Second canonical paid sequence is saved mid-cue to test reopen interruption.'};
    for(let i=0;i<state.agents.length;i++)require(JSON.stringify(state.agents[i].position)===JSON.stringify(initialPositions[i]),'Fixture moved an actor');
    return result;
  }
  function interrupt(){
    require(['pending-save','pending-response-save'].includes(phase),'Expected pending cue');
    const responseCase=phase==='pending-response-save',actor=responseCase?listener:sender;
    const paid=discoveryActionPaidSeconds(actor,pendingActive);
    cancelNpcAction(actor,'NATIVE_FIXTURE_INTERRUPTION');
    require(!(responseCase?responsePose():pose())&&!successfulDiscoveryActionCompletion(actor,pendingActive),
      'Interruption fabricated completion or retained cue');
    reference.afterTick();
    if(responseCase)require(reference.snapshot().latest.feedbackStatus==='censored'&&reference.snapshot().senderFeedback.length===0,
      'Interrupted pending response cannot gain a second feedback event');
    checks.interruption={paidSeconds:paid,result:structuredClone(actor.lastResult),poseCleared:true,
      pendingKind:responseCase?'listener-response':'sender-demonstration'};
    require(paid>0&&paid<1.8,'Interruption must retain genuine partial paid work');phase='interrupted';return status();
  }
  return {project,status,beginChoice,completeChoice,beginIndication,visible,completeIndication,beginResponse,visibleResponse,completeResponse,
    inspectAssociation,pendingForSave,pendingResponseForSave,checkpoint,interrupt,
    dispose(){sensor.dispose?.();}};
}

/** Read-only replay attempts on copies of the actual independently reopened
 * application's actors. They cannot alter the actual loaded main population. */
export async function probeVisualReferenceReopen(moduleBase,state,serializedActive,serializedPermit,
  {pendingKind='sender-demonstration',serializedDemonstrationActive=null}={}) {
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
  const actor=responseCase?listener:sender;
  actor.active=structuredClone(serializedActive);const copiedActivePose=publicIndicationGeometry(actor);actor.active=null;
  const result={copiedActivePose,pose:publicIndicationGeometry(actor),completion:successfulDiscoveryActionCompletion(actor,serializedActive),
    permit:responseCase?createListenerResponsePermit(listener,sender,serializedDemonstrationActive):
      createIndicationPermit(sender,listener,serializedActive,serializedActive.request.targetId),
    copiedPermitResult:requestNpcIndication(actor,serializedPermit,state.environment),active:actor.active};
  if(result.copiedActivePose||result.pose||result.completion||result.permit||result.copiedPermitResult.ok||result.active)throw new Error('Reopened data revived runtime indication authority');
  return {...result,noRevivedAuthority:true,scope:'Fresh sight on copies of actual reopened state; no second clock or actual-main mutation'};
}
