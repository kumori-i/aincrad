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
  const {FREE_HAND_RULES,freeHandBodySafe,freeHandExplorationChoice,publicFreeHandGeometry,ownFreeHandAction,
    freeHandPaidSeconds,readFreeHandObserver}=await use('free-hand-action');
  const {observeIndication,senseReferenceObjects,resolveIndication,visibleIndicationGeometry,sensePublicPeerGesture}=await use('visual-reference-perception');
  const {actorLineOfSight}=await use('perception');
  const {createCommunicationPixelSensor,poolCommunicationPixels}=await use('communication-pixels');
  const {recentDiscoveryAim}=await use('discovery');
  const {lookupEcologyObject,renderEcology}=await use('ecology');
  const {REFERENCE_LIMITS,findReferencePeer}=await use('visual-reference-attachment');
  const {bodySignals}=await use('interoception');
  const {isSleeping}=await use('biology');
  const {npcEffortCost}=await use('npc-effort-funding');
  const {CHARACTER_CORE,classifyOwnDemonstration,listenerDistribution}=await use('character-message-core');
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
  require(context.motorScenario!==true||context.responseScenario!==true&&context.ambiguityScenario!==true&&
    sender.id==='aster'&&listener.id==='mira'&&sender.position.x===276&&sender.position.y===760&&
    listener.position.x===300&&listener.position.y===920&&
    actorLineOfSight(sender,sender.position,listener.position)&&
    actorLineOfSight(listener,listener.position,sender.position),
  'Target-free motor fixture requires original mutually visible fresh actors');
  let authoredObjectSwap=null;
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
  if(context.ambiguityScenario===true){
    // Engineering-only geometry: exchange positions of two existing ripe plants
    // before observation. The tree's crown/trunk and the grass's blades use
    // unchanged real art; no object, stock, crop or sensory value is invented.
    require(context.responseScenario!==true&&sender.id==='aster'&&listener.id==='mira'&&
      sender.position.x===276&&sender.position.y===760&&listener.position.x===300&&listener.position.y===920,
    'Authored ambiguity fixture requires exact fresh actors');
    require(geometry.canOccupy(-12943,3595)&&geometry.canOccupy(-12827,3543),
      'Authored ambiguity positions must be physically occupiable');
    const ecology=state.environment.ecology,
      bramble=lookupEcologyObject(ecology,'object:504'),tree=lookupEcologyObject(ecology,'object:505');
    require(ecology.seed===74193&&bramble?.kind==='bramble'&&bramble.stage==='ripe'&&
      tree?.kind==='apple_tree'&&tree.stage==='ripe','Authored ambiguity requires the declared fresh ecology');
    near(bramble.position.x,-12876.9761711114,'Original bramble x');
    near(bramble.position.y,3676.0703545399747,'Original bramble y');
    near(tree.position.x,-12637.114480087068,'Original tree x');
    near(tree.position.y,3800.9655602960443,'Original tree y');
    const brambleOriginal={...bramble.position},treeOriginal={...tree.position};
    ecology.plants=ecology.plants.map(plant=>plant.id===bramble.id?
      {...plant,position:{...treeOriginal}}:plant.id===tree.id?
        {...plant,position:{...brambleOriginal}}:plant);
    // Replacing the plants array also invalidates ecology's spatial index.
    authoredObjectSwap={bramble:{id:bramble.id,kind:bramble.kind,original:brambleOriginal,placed:treeOriginal},
      tree:{id:tree.id,kind:tree.kind,original:treeOriginal,placed:brambleOriginal}};
    sender.position.x=-12943;sender.position.y=3595;
    listener.position.x=-12827;listener.position.y=3543;
    require(actorLineOfSight(listener,listener.position,sender.position),
      'Authored ambiguity actors must see each other');
  }
  const initialPositions=state.agents.map(n=>({...n.position}));
  const sensor=context.auditSensor||createCommunicationPixelSensor(document);
  const actualCanvas=!context.auditSensor;
  const audit=[],responseAudit=[],steps=[],checks={};
  let choiceActive,indicationActive,responseActive,pendingActive,privateTargetId,choiceProof,indicationProof,baseline,responseBaseline;
  let firstMotorActive=null,secondMotorActive=null,motorBaseline=null;
  let secondStarted=false,secondChoiceActive=null,secondDemoActive=null;
  let phase=context.motorScenario===true?'motor-ready':'ready';
  const characterState=()=>reference.exportPersistence().characterMessages;
  const ownerState=id=>characterState().learners.find(row=>row.agentId===id);
  const partnerState=(ownerId,partnerId)=>ownerState(ownerId).partners.find(row=>row.agentId===partnerId).listener;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const beforeCharacters=structuredClone(characterState());
  const originalSender=beforeCharacters.learners.find(row=>row.agentId===sender.id).sender;
  const originalListener=beforeCharacters.learners.find(row=>row.agentId===listener.id).partners[0].listener;
  let admissionCrops=null;
  const holdUntil=state.elapsed+(context.motorScenario===true?125:20);
  // Bounded deliberate command scheduling, NOT bodily holds: the same ordinary
  // population still integrates every environment, ecology and body fixed step.
  for(const n of state.agents){n.nextDecisionAt=holdUntil;observeNpc(n,state.environment);}
  if(context.motorScenario===true){
    require(FREE_HAND_RULES.seconds===1.8&&FREE_HAND_RULES.effort===.25&&
      FREE_HAND_RULES.cooldownSeconds===120,'Native motor fixture requires the reviewed fixed physical rules');
    const initial=state.agents.map(actor=>readFreeHandObserver(actor));
    require(initial.every(row=>row.nextEligibleAt>=120&&row.selectedAttempts===0&&
      row.eligibleDecisions===0&&row.visibleSamples===0),
    'Both independent fresh actors must begin behind the full motor delay');
    require(freeHandExplorationChoice(sender)===null&&freeHandExplorationChoice(listener)===null&&
      requestNpcAction(sender,{type:'free_hand'},state.environment).code==='FREE_HAND_COOLDOWN'&&
      sender.active===null,'A fresh world cannot perform an immediate target-free motor trial');
    checks.motorFresh={scope:'Original actors and ecology; no new object, message, cue, resource or response',
      initial,firstAdmission:'FREE_HAND_COOLDOWN',actualCanvas};
  }
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
  if(context.ambiguityScenario===true){
    const own=senseReferenceObjects(listener,state),other=senseReferenceObjects(sender,state);
    require(own.complete&&other.complete,'Authored ambiguity requires complete ordinary sight');
    const forwardIds=[];
    for(let i=0;i<own.objects.length;i++){
      const id=own.bindings[i],j=other.bindings.indexOf(id);if(j<0)continue;
      const position=own.objects[i].position,cue=referenceGeometry(sender.position,position,sender.scene,1);
      if(!cue||!visibleIndicationGeometry(listener,cue)||resolveIndication(cue,own.objects).index!==i)continue;
      forwardIds.push(id);
      const reply=referenceGeometry(listener.position,position,listener.scene,1);
      require(reply&&visibleIndicationGeometry(sender,reply)&&resolveIndication(reply,other.objects).reason==='ambiguous',
        'Every forward candidate must have an ambiguous reverse bearing in fresh sender sight');
    }
    require(forwardIds.length===2&&forwardIds.includes('object:501')&&forwardIds.includes('object:505'),
      'Authored ambiguity geometry requires only the declared grass and tree candidates');
    checks.authoredAmbiguity={scope:'Engineering-only positions of two existing ripe plants and both actors before observation/action; no object creation, crop override or ordinary opportunity claim',
      senderOriginal:{x:276,y:760},listenerOriginal:{x:300,y:920},
      senderPlaced:{...sender.position},listenerPlaced:{...listener.position},
      objectSwap:authoredObjectSwap,forwardCandidateCount:forwardIds.length,forwardCandidateIds:forwardIds,
      reverseResult:'ambiguous',
      peerDistance:Math.hypot(listener.position.x-sender.position.x,listener.position.y-sender.position.y)};
  }
  if(renderer){renderer.followNpc=true;renderer.followId=sender.id;renderer.targetZoom=2;renderer.snap(sender.position);}
  const project=()=>projectEvidence(state);
  const pose=()=>publicIndicationGeometry(sender);
  const responsePose=()=>publicIndicationGeometry(listener);
  const motorPose=actor=>publicFreeHandGeometry(actor);
  function localGesture(observer,peer,visibility){
    const memory=reference.readGestureMemory(observer),row=memory?.records.at(-1);
    require(row?.visibility===visibility,`Actual ${observer.id} local gesture visibility must be ${visibility}`);
    require(Object.keys(row).sort().join(',')===
      'at,continuousAbsenceSeconds,continuousVisible,peer,pose,self,visibility,visibleSeconds',
    'Actor-local gesture row has an unexpected field');
    require(Object.keys(row.self).sort().join(',')==='actionActive,freeHandActive,freeHandPose,poseProgress'&&
      row.self.actionActive===Number(!!observer.active),
    'Gesture memory must carry only the actor’s own public motion context');
    near(row.at,observer.elapsed,'Actor-local gesture sample time');
    const ownPose=publicIndicationGeometry(observer);
    require(row.self.poseProgress===(ownPose?.progress??motorPose(observer)?.progress??null),
      'Own pose progress must come from the actor’s paid public action');
    const ownMotor=motorPose(observer);
    require(row.self.freeHandActive===Number(ownFreeHandAction(observer))&&
      Boolean(row.self.freeHandPose)===Boolean(ownMotor),
    'Own motor identity must come from private current action authority and paid pose');
    if(ownMotor){
      for(const endpoint of ['origin','tip']){
        near(row.self.freeHandPose[endpoint].dx,ownMotor[endpoint].x-observer.position.x,
          'Own motor '+endpoint+' dx');
        near(row.self.freeHandPose[endpoint].dy,ownMotor[endpoint].y-observer.position.y,
          'Own motor '+endpoint+' dy');
      }
      near(row.self.freeHandPose.progress,ownMotor.progress,'Own motor paid progress');
    }
    if(visibility==='unknown'){
      require(row.pose===null,'Unknown sight cannot become a pose');
      return {visibility,at:row.at};
    }
    require(Object.keys(row.peer).sort().join(',')==='dx,dy','Peer sight may contain only relative numeric coordinates');
    near(row.peer.dx,peer.position.x-observer.position.x,'Actor-local peer dx');
    near(row.peer.dy,peer.position.y-observer.position.y,'Actor-local peer dy');
    const publicPose=publicIndicationGeometry(peer)||motorPose(peer);
    if(visibility==='absent')require(row.pose===null&&!publicPose,'Visible absence requires no paid public pose');
    else{
      require(publicPose&&row.pose&&Object.keys(row.pose).sort().join(',')==='origin,progress,tip',
        'Only the actual paid public segment may enter gesture memory');
      for(const endpoint of ['origin','tip']){
        require(Object.keys(row.pose[endpoint]).sort().join(',')==='dx,dy',
          'Pose coordinates must be relative numeric values');
        near(row.pose[endpoint].dx,publicPose[endpoint].x-observer.position.x,endpoint+' local dx');
        near(row.pose[endpoint].dy,publicPose[endpoint].y-observer.position.y,endpoint+' local dy');
      }
      near(row.pose.progress,publicPose.progress,'Actor-local paid pose progress');
      require(row.continuousVisible&&row.visibleSeconds>0,'Funded public pose needs consecutive local sight');
    }
    return {visibility,at:row.at,continuousVisible:row.continuousVisible,
      ownActionActive:row.self.actionActive,ownPoseProgress:row.self.poseProgress,
      ownFreeHandActive:row.self.freeHandActive,
      ...(row.self.freeHandPose?{ownFreeHandPose:structuredClone(row.self.freeHandPose)}:{}),
      ...(row.pose?{relativeOrigin:{...row.pose.origin},relativeTip:{...row.pose.tip},progress:row.pose.progress}:{})};
  }
  function localGestureReadOnly(observer){
    const beforeWorld=JSON.stringify(project()),beforeCharacter=JSON.stringify(characterState()),
      beforePersistence=JSON.stringify(reference.exportPersistence()),
      original=JSON.stringify(reference.readGestureMemory(observer));
    const copy=reference.readGestureMemory(observer);
    require(copy.records.length>0,'Expected an actual local gesture sample');
    if(copy.records.at(-1).pose)copy.records.at(-1).pose.tip.dx=999999;
    if(copy.records.at(-1).self.freeHandPose)copy.records.at(-1).self.freeHandPose.tip.dy=999999;
    copy.records.length=0;copy.limits.capacity=0;
    require(JSON.stringify(reference.readGestureMemory(observer))===original&&
      JSON.stringify(project())===beforeWorld&&JSON.stringify(characterState())===beforeCharacter&&
      JSON.stringify(reference.exportPersistence())===beforePersistence,
    'Reading or changing a copied local gesture view altered the world, RNG, model or private history');
    return true;
  }
  function localPrediction(observer){
    const result=reference.readGesturePrediction(observer);
    require(result&&result.limits?.horizonTicks===30&&result.limits?.replayCapacity===0&&
      result.limits?.maximumUpdatesPerSecond===2,
    'Actor-local predictor must use the declared bounded future horizon without replay');
    for(const key of ['forecasts','validTargets','updates','censoredUnknown','censoredGap',
      'targetPose','targetAbsent','onsets','offsets','stablePose','stableAbsent'])
      require(Number.isSafeInteger(result[key])&&result[key]>=0,`Invalid local prediction count ${key}`);
    require(typeof result.pending==='boolean'&&result.validTargets===result.updates&&
      result.targetPose+result.targetAbsent===result.validTargets&&
      result.onsets+result.stablePose===result.targetPose&&
      result.offsets+result.stableAbsent===result.targetAbsent&&
      result.forecasts>=result.validTargets,
    'Local prediction counts must distinguish valid future sight from pending and censored windows');
    for(const score of Object.values(result.scores))
      require(Number.isFinite(score.brier)&&score.brier>=0&&Number.isFinite(score.logLoss)&&score.logLoss>=0,
      'Prequential scores must be finite nonnegative aggregates');
    require(!Object.keys(result).some(key=>['weights','features','targetId','partnerId','critic','reward'].includes(key)),
      'Actor-local prediction readout exposed private input or privileged outcome data');
    return result;
  }
  function localPredictionReadOnly(observer){
    const beforeWorld=JSON.stringify(project()),beforeCharacter=JSON.stringify(characterState()),
      beforePersistence=JSON.stringify(reference.exportPersistence()),
      original=JSON.stringify(localPrediction(observer));
    const copy=reference.readGesturePrediction(observer);
    copy.forecasts=0;copy.scores.model.brier=-1;copy.scoresByTarget.pose.model.logLoss=-1;
    copy.limits.horizonTicks=0;
    require(JSON.stringify(localPrediction(observer))===original&&
      JSON.stringify(project())===beforeWorld&&JSON.stringify(characterState())===beforeCharacter&&
      JSON.stringify(reference.exportPersistence())===beforePersistence,
    'Reading or changing copied local prediction totals altered the world, RNG or learner');
    return true;
  }
  function admissionAudit(){
    require(context.ambiguityScenario===true&&phase==='ready',
      'Pre-action Canvas admission audit is confined to the fresh engineering ambiguity scenario');
    const beforePersistence=JSON.stringify(reference.exportPersistence()),beforeReference=JSON.stringify(reference.snapshot()),
      beforeElapsed=state.elapsed,beforePositions=JSON.stringify(state.agents.map(actor=>actor.position));
    const own=senseReferenceObjects(listener,state),other=senseReferenceObjects(sender,state),
      ownCrops=sensor.capture(listener,state),otherCrops=sensor.capture(sender,state),
      sprites=new Set(renderEcology(state.environment.ecology,sender.scene).map(sprite=>sprite.id));
    const valid=(crop,actor)=>!!crop&&crop.epoch===actor.epoch&&Number.isFinite(crop.at)&&crop.at<=actor.elapsed&&
      actor.elapsed-crop.at<=1.1&&crop.features?.length===48&&crop.features.every(value=>Number.isFinite(value)&&value>=0&&value<=1)&&
      crop.pixels?.length===768;
    const cropRow=(actor,id,crop)=>({present:!!crop,valid:valid(crop,actor),at:crop?.at??null,
      epoch:crop?.epoch??null,observedAt:actor.discovery.observations[id]?.observedAt??null,
      observationAge:actor.discovery.observations[id]?actor.elapsed-actor.discovery.observations[id].observedAt:null,
      recentDirectAim:!!recentDiscoveryAim(actor,id),spriteInProjection:sprites.has(id)});
    const candidates=[],rows=[];
    for(let i=0;i<own.objects.length;i++){
      const id=own.bindings[i],j=other.bindings.indexOf(id),a=ownCrops.get(id),b=otherCrops.get(id),
        cue=j>=0?referenceGeometry(sender.position,own.objects[i].position,sender.scene,1):null,
        visible=cue?!!visibleIndicationGeometry(listener,cue):false,
        parsed=visible?resolveIndication(cue,own.objects):null,
        numericForward=j>=0&&visible&&parsed?.index===i;
      const row={id,kind:lookupEcologyObject(state.environment.ecology,id)?.kind??null,
        listenerSightIndex:i,senderSightIndex:j,listenerCrop:cropRow(listener,id,a),senderCrop:cropRow(sender,id,b),
        numericForward,geometryReason:parsed?.reason??(cue?'gesture-not-visible':'not-shared-or-no-geometry')};
      if(rows.length<96)rows.push(row);
      if(numericForward&&valid(a,listener)&&valid(b,sender))candidates.push({id,own:a.features,other:b.features});
    }
    const rms=(a,b)=>Math.sqrt(a.reduce((sum,value,index)=>sum+(value-b[index])**2,0)/a.length),pairs=[];
    let pairCount=0,qualifiedPairs=0;
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
      const ownRms=rms(candidates[i].own,candidates[j].own),senderRms=rms(candidates[i].other,candidates[j].other),
        qualified=ownRms>=REFERENCE_LIMITS.featureDistance&&senderRms>=REFERENCE_LIMITS.featureDistance;
      pairCount++;if(qualified)qualifiedPairs++;
      if(pairs.length<64)pairs.push({ids:[candidates[i].id,candidates[j].id],ownRms,senderRms,qualified});
    }
    const signals=bodySignals(listener),urgent=['ravenous','faint with hunger'].includes(signals.hunger)||
      ['parched','desperate thirst'].includes(signals.thirst)||signals.energy==='depleted'||signals.pain==='severe',
      peer=findReferencePeer(state.agents,listener,new Map()),ecology=state.environment.ecology;
    return {scope:'Read-only pre-action engineering audit; no pair, target, message or listener choice is committed',
      actualCanvas,elapsed:state.elapsed,featureDistance:REFERENCE_LIMITS.featureDistance,
      genericGates:{receiverAwake:listener.lifecycle==='AWAKE'&&!isSleeping(listener),receiverUrgent:urgent,
        receiverActive:!!listener.active,noExchangeYet:reference.snapshot().exchanges===0,
        peerFound:peer.sender===sender,peerFirstFailure:peer.firstFailure,
        peerDistance:Math.hypot(sender.position.x-listener.position.x,sender.position.y-listener.position.y),
        peerLineOfSight:actorLineOfSight(listener,listener.position,sender.position)},
      sight:{listenerComplete:own.complete,listenerReason:own.reason,listenerCount:own.objects.length,
        senderComplete:other.complete,senderReason:other.reason,senderCount:other.objects.length},
      crops:{listenerCount:ownCrops.size,senderCount:otherCrops.size},
      rows,pairs,pairCount,validForwardCandidates:candidates.length,qualifiedPairs,
      rowCap:96,pairCap:64,rowsTruncated:own.objects.length>rows.length,pairsTruncated:pairCount>pairs.length,
      ecologySeed:ecology.seed,communicationSeed:reference.snapshot().seed,
      pure:{referencePersistence:JSON.stringify(reference.exportPersistence())===beforePersistence,
        referenceSnapshot:JSON.stringify(reference.snapshot())===beforeReference,
        elapsed:state.elapsed===beforeElapsed,positions:JSON.stringify(state.agents.map(actor=>actor.position))===beforePositions}};
  }
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
  /** Bounded real fixed steps reach the production 120-second first-admission
   * delay. This fixture schedules commands, never changes elapsed/body clocks. */
  function motorWait(batch){
    require(context.motorScenario===true&&phase==='motor-ready'&&Number.isInteger(batch)&&batch>0&&batch<=600&&
      state.elapsed+batch*fixedStep<=FREE_HAND_RULES.cooldownSeconds+1e-7,
    'Motor wait must use a bounded genuine world-step batch');
    const beforeCharacter=JSON.stringify(characterState());
    const before={elapsed:state.elapsed,environment:state.environment.elapsed,
      ecology:state.environment.ecology.elapsed+state.environment.ecology.pending,
      bodies:state.agents.map(actor=>actor.elapsed)};
    for(let i=0;i<batch;i++){
      for(const actor of state.agents)actor.nextDecisionAt=holdUntil;
      require(step()!==false,'Real main-world motor wait step rejected');
    }
    near(state.elapsed-before.elapsed,batch*fixedStep,'Motor wait main-world time');
    near(state.environment.elapsed-before.environment,batch*fixedStep,'Motor wait environment time');
    near(state.environment.ecology.elapsed+state.environment.ecology.pending-before.ecology,
      batch*fixedStep,'Motor wait ecology time');
    for(let index=0;index<state.agents.length;index++)
      near(state.agents[index].elapsed-before.bodies[index],batch*fixedStep,'Motor wait body time');
    require(JSON.stringify(characterState())===beforeCharacter&&
      state.agents.every((actor,index)=>!actor.active&&
        JSON.stringify(actor.position)===JSON.stringify(initialPositions[index])),
    'Waiting for motor readiness cannot sample a character string or script an action');
    return {elapsed:state.elapsed,steps:Math.round(state.elapsed/fixedStep),
      observers:state.agents.map(actor=>({id:actor.id,...readFreeHandObserver(actor)}))};
  }
  /** A temporary, pre-action engineering placement checks the same actor-local
   * current cue used by the ordinary optional motor offer. It advances no clock,
   * samples no message and restores the original actor before paid work. */
  function probeFlowingCurrentMotor(){
    require(context.motorScenario===true&&phase==='motor-ready'&&
      state.elapsed+1e-7>=FREE_HAND_RULES.cooldownSeconds&&
      state.agents.every((actor,index)=>actor.active===null&&
        same(actor.position,initialPositions[index])),
    'Flowing-current offer probe requires idle original-position actors after the real delay');
    const point={x:-1200,y:240},original={...sender.position},
      beforeWorld=JSON.stringify(projectEvidence(state)),
      beforeReference=JSON.stringify(reference.snapshot()),
      beforeCharacter=JSON.stringify(characterState()),
      beforeLocal=state.agents.map(actor=>({memory:reference.readGestureMemory(actor),
        prediction:reference.readGesturePrediction(actor)})),
      beforeSaved=localStorage.getItem(OZARK_SAVE_KEY),
      beforeObserver=readFreeHandObserver(sender),beforePeer=readFreeHandObserver(listener);
    require(freeHandBodySafe(sender)&&beforeObserver.nextEligibleAt<=sender.elapsed&&
      geometry.canOccupy(point.x,point.y),
    'Current probe must isolate local footing from body, cooldown or invalid placement');
    let observed,offered,during;
    try{
      sender.position.x=point.x;sender.position.y=point.y;
      observed=geometry.observe(sender.position);
      require(observed.ground==='shallow-water'&&observed.currentCue==='downstream',
        'Declared temporary footing must have an actor-local flowing-current cue');
      offered=freeHandExplorationChoice(sender);
      during=readFreeHandObserver(sender);
      require(offered===null&&sender.active===null&&!ownFreeHandAction(sender)&&
        publicFreeHandGeometry(sender)===null&&
        same(during,{...beforeObserver,decisionChecks:beforeObserver.decisionChecks+1}),
      'Flowing-current footing must suppress only the optional offer, without action authority');
    }finally{
      sender.position.x=original.x;sender.position.y=original.y;
    }
    require(JSON.stringify(projectEvidence(state))===beforeWorld&&
      JSON.stringify(reference.snapshot())===beforeReference&&
      JSON.stringify(characterState())===beforeCharacter&&
      same(state.agents.map(actor=>({memory:reference.readGestureMemory(actor),
        prediction:reference.readGesturePrediction(actor)})),beforeLocal)&&
      localStorage.getItem(OZARK_SAVE_KEY)===beforeSaved&&
      same(readFreeHandObserver(sender),during)&&
      same(readFreeHandObserver(listener),beforePeer)&&
      state.agents.every((actor,index)=>actor.active===null&&
        same(actor.position,initialPositions[index])),
    'Temporary current probe must restore the whole world and preserve models, save and authority');
    checks.motorCurrentFooting={scope:'engineering-only temporary pre-action actor placement',
      point,ground:observed.ground,currentCue:observed.currentCue,
      offered:false,decisionChecksDelta:1,eligibleDecisionsDelta:0,
      selectedAttemptsDelta:0,admittedDelta:0,worldRestored:true,
      characterUnchanged:true,localModelsUnchanged:true,savedBytesUnchanged:true};
    return status();
  }
  function beginMotor(actorId){
    require(context.motorScenario===true&&state.elapsed+1e-7>=FREE_HAND_RULES.cooldownSeconds&&
      (actorId===sender.id&&phase==='motor-ready'||actorId===listener.id&&phase==='motor-first-complete'),
    'Expected each actor’s first target-free optional motor admission');
    const actor=actorId===sender.id?sender:listener,peer=actor===sender?listener:sender,
      candidate=freeHandExplorationChoice(actor),prior=readFreeHandObserver(actor),
      priorCharacter=JSON.stringify(characterState());
    require(candidate?.action?.type==='free_hand'&&Object.keys(candidate.action).length===1&&
      prior.selectedAttempts===0&&peer.active===null&&
      sensePublicPeerGesture(peer,actor).visibility==='absent',
    'Motor candidate must contain no target, peer, meaning or pre-existing pose');
    const start={at:state.elapsed,metabolized:actor.physiology.totals.metabolizedKcal,
      available:actor.physiology.availableEnergyKcal,observer:prior};
    const result=requestNpcAction(actor,candidate.action,state.environment);
    const admitted=readFreeHandObserver(actor);
    require(result.code==='ACTION_STARTED'&&ownFreeHandAction(actor)&&!motorPose(actor)&&
      !pose()&&!responsePose()&&JSON.stringify(characterState())===priorCharacter&&
      admitted.lifecycle.admitted===1&&admitted.lifecycle.firstPaid===0&&
      admitted.lifecycle.certifiedPaidSeconds===0&&admitted.lifecycle.pending===1,
    'A target-free admission must be genuine, unpaid and unrelated to character messages');
    if(actor===sender){firstMotorActive=actor.active;motorBaseline=start;phase='motor-first-active';}
    else{secondMotorActive=actor.active;checks.motorSecondBaseline=start;phase='motor-second-active';}
    return {phase,at:state.elapsed,observer:admitted,
      action:{type:actor.active.request.type,seconds:actor.active.seconds,expiresAt:actor.active.expiresAt},
      pose:motorPose(actor),characterUnchanged:true};
  }
  function visibleMotor(actorId){
    require(context.motorScenario===true&&
      (actorId===sender.id&&phase==='motor-first-active'||actorId===listener.id&&phase==='motor-second-active'),
    'Expected a funded main-world hand motion');
    const actor=actorId===sender.id?sender:listener,peer=actor===sender?listener:sender;
    for(let i=0;i<40;i++)tick();
    const g=motorPose(actor),peerLocal=localGesture(peer,actor,'pose'),ownLocal=localGesture(actor,peer,'absent');
    require(g&&g.progress>0&&g.progress<1&&near(g.tip.x-g.origin.x,0,'Target-free segment x')===undefined&&
      near(g.tip.y-g.origin.y,-FREE_HAND_RULES.length,'Target-free segment y')===undefined,
    'A paid motor slice must render the fixed target-free numeric segment');
    require(peerLocal.ownFreeHandActive===0&&ownLocal.ownFreeHandActive===1&&
      ownLocal.ownFreeHandPose?.progress===g.progress&&
      observeIndication(peer,actor,state).objectId===null&&
      reference.snapshot().observationEvents.length===0,
    'A visible hand movement may enter local sight, never the object parser or character feedback');
    const peerPrediction=localPrediction(peer),ownPrediction=localPrediction(actor);
    require(peerPrediction.targetPose>=1&&peerPrediction.onsets>=1,
      'Actual later personally visible pose must settle a local forecast');
    const observer=readFreeHandObserver(peer),actorObserver=readFreeHandObserver(actor);
    require(observer.visibleSamples>=30&&actorObserver.lifecycle.firstPaid===1&&
      actorObserver.lifecycle.certifiedPaidSeconds>0&&
      actorObserver.lifecycle.certifiedPaidSeconds<FREE_HAND_RULES.seconds&&
      actorObserver.lifecycle.ownPoseSamples>0&&actorObserver.lifecycle.pending===1,
    'Actual peer and own sight must count repeated genuinely funded pose samples');
    let occluded=null;
    if(actor===sender){
      const p={x:496,y:760};
      require(geometry.canOccupy(p.x,p.y)&&!geometry.lineOfSight(p,sender.position),
        'Controlled observer copy must stand behind actual terrain occlusion');
      const copy=structuredClone(peer);copy.position=p;
      const observationState={...state,agents:state.agents.map(n=>n===peer?copy:n)};
      bindOzarkWorldAgent(copy,geometry,observationState);
      const unseen=sensePublicPeerGesture(copy,actor);
      require(unseen.visibility==='unknown'&&unseen.pose===null&&
        observeIndication(copy,actor,observationState).objectId===null,
      'Occlusion is unknown local sight, not observed silence or an object label');
      occluded={position:p,visibility:unseen.visibility};
    }
    const evidence={actualCanvas,actor:actor.id,peer:peer.id,geometry:g,
      peerLocal,ownLocal,observer,actorObserver,occluded,
      peerPrediction:{validTargets:peerPrediction.validTargets,targetPose:peerPrediction.targetPose,
        onsets:peerPrediction.onsets},
      ownPrediction:{validTargets:ownPrediction.validTargets},
      memoryReadPure:localGestureReadOnly(peer)&&localGestureReadOnly(actor),
      predictionReadPure:localPredictionReadOnly(peer)&&localPredictionReadOnly(actor)};
    if(actor===sender)checks.motorFirstVisible=evidence;else checks.motorSecondVisible=evidence;
    return {phase,elapsed:state.elapsed,...evidence};
  }
  function completeFirstMotor(){
    require(context.motorScenario===true&&phase==='motor-first-active'&&firstMotorActive,
      'Expected Aster’s first paid target-free movement');
    until(()=>sender.active!==firstMotorActive,'First genuine paid hand motion did not finish',130);
    const worked=freeHandPaidSeconds(sender,firstMotorActive),
      effort=npcEffortCost(worked,FREE_HAND_RULES.effort),
      metabolized=sender.physiology.totals.metabolizedKcal-motorBaseline.metabolized,
      availableLoss=motorBaseline.available-sender.physiology.availableEnergyKcal;
    near(worked,FREE_HAND_RULES.seconds,'Full funded motor seconds');
    near(sender.lastResult.durationSeconds,worked,'Recorded funded motor duration');
    require(sender.lastResult.code==='FREE_HAND_MOVED'&&sender.lastResult.ok===true&&
      !motorPose(sender)&&!ownFreeHandAction(sender)&&
      metabolized+1e-8>=effort&&availableLoss+1e-8>=effort&&
      sender.discovery.experiments.length===0&&JSON.stringify(characterState())===JSON.stringify(beforeCharacters),
    'Full ordinary paid effort must complete without object practice or character learning');
    const ended=localGesture(listener,sender,'absent'),observer=readFreeHandObserver(sender);
    require(observer.selectedAttempts===1&&observer.nextEligibleAt>=sender.elapsed+FREE_HAND_RULES.cooldownSeconds-2&&
      observer.lifecycle.admitted===1&&observer.lifecycle.firstPaid===1&&
      Math.abs(observer.lifecycle.certifiedPaidSeconds-FREE_HAND_RULES.seconds)<1e-7&&
      observer.lifecycle.completed===1&&observer.lifecycle.pending===0&&
      ended.ownFreeHandActive===0,
    'Completion consumes one actor-local rate budget and leaves visible absence');
    checks.motorFirstComplete={worked,effortKcal:effort,metabolizedKcal:metabolized,
      availableEnergyLossKcal:availableLoss,result:structuredClone(sender.lastResult),
      observer,ended,characterUnchanged:true};
    phase='motor-first-complete';return status();
  }
  function checkpointMotor(storage){
    require(context.motorScenario===true&&phase==='motor-second-active'&&
      secondMotorActive===listener.active,'Expected Mira’s distinct live paid motor action');
    const paid=freeHandPaidSeconds(listener,secondMotorActive),
      beforeCharacter=JSON.stringify(characterState()),
      priorPrediction=state.agents.map(actor=>localPrediction(actor));
    require(paid>0&&paid<FREE_HAND_RULES.seconds&&motorPose(listener),
      'Pending save must occur inside a genuinely paid incomplete motor action');
    require(saveCheckpoint()===true,'One ordinary save of pending funded motor action failed');
    const raw=storage.getItem(OZARK_SAVE_KEY),document=raw&&JSON.parse(raw);
    require(document&&JSON.stringify(characterState())===beforeCharacter&&
      state.agents.every((actor,index)=>same(localPrediction(actor),priorPrediction[index]))&&
      !Object.hasOwn(document,'actorGestureMemory')&&
      document.agents.every(actor=>!Object.hasOwn(actor,'actorGestureMemory')&&
        !Object.hasOwn(actor,'freeHandAuthority'))&&
      !/"(?:actorGesturePrediction|actorGesturePredictor|gesturePrediction|gesturePredictor|freeHandAuthority|freeHandObserver)"/.test(raw),
    'Pending save must exclude motor authority, local gesture rows and predictor state');
    const loaded=loadOzarkSave({getItem:key=>key===OZARK_SAVE_KEY?raw:null},geometry);
    require(!loaded.blocked&&loaded.state.agents.every(actor=>!actor.active),
      'Strict ordinary reload must interrupt the pending motor command');
    const report=status();
    const observer=readFreeHandObserver(listener);
    require(observer.lifecycle.admitted===1&&observer.lifecycle.firstPaid===1&&
      observer.lifecycle.certifiedPaidSeconds>0&&observer.lifecycle.completed===0&&
      observer.lifecycle.pending===1,
    'Pending checkpoint retains only live local observer credit for certified partial work');
    checks.motorPending={paidSeconds:paid,modeledEffortKcal:npcEffortCost(paid,FREE_HAND_RULES.effort),
      actor:listener.id,observer,characterUnchanged:true,saveExcluded:true};
    return {raw,expectedRestored:projectEvidence(loaded.state),serializedActive:structuredClone(secondMotorActive),
      report:{...report,checks:{...report.checks,motorPending:checks.motorPending}},
      pendingKind:'free-hand',characterPersistence:structuredClone(characterState()),
      fixtureDisclosure:'Separate fresh seed-211 main-world engineering profile with unchanged ecology and real 1/60-second environment and body ticks. A bounded 120-second command schedule reaches the ordinary per-actor motor cooldown without editing clocks. Before paid action, Aster is temporarily placed at declared shallow-current point (-1200,240) for one actor-local offer check, then restored to the original spawn without time, action, model, RNG or save change. Aster completes one funded 1.8-second target-free hand motion from the original position; Mira later begins her independent first motion and is saved during paid partial work. No object, message, crop, resource, partner response, semantic reward or alternate production rule is injected.'};
  }
  function interruptMotor(){
    require(context.motorScenario===true&&phase==='motor-second-active'&&listener.active===secondMotorActive,
      'Expected pending funded Mira motor action');
    const beforeCharacter=JSON.stringify(characterState()),
      beforePrediction=state.agents.map(actor=>localPrediction(actor)),
      beforeCounts=state.agents.map(actor=>readFreeHandObserver(actor)),
      paid=freeHandPaidSeconds(listener,secondMotorActive);
    cancelNpcAction(listener,'PRIORITY_CHANGED');
    const afterCounts=state.agents.map(actor=>readFreeHandObserver(actor));
    const expectedInterruption={...beforeCounts[1],lifecycle:{...beforeCounts[1].lifecycle,
      pending:0,interrupted:{...beforeCounts[1].lifecycle.interrupted,
        PRIORITY_CHANGED:beforeCounts[1].lifecycle.interrupted.PRIORITY_CHANGED+1}}};
    require(!motorPose(listener)&&!ownFreeHandAction(listener)&&
      listener.lastResult.ok===false&&listener.lastResult.durationSeconds===paid&&
      same(afterCounts[0],beforeCounts[0])&&same(afterCounts[1],expectedInterruption),
    'Cancellation must retire the actual paid pose and preserve partial work');
    reference.afterTick();
    require(state.agents.every((actor,index)=>same(localPrediction(actor),beforePrediction[index])&&
      same(readFreeHandObserver(actor),afterCounts[index]))&&
      JSON.stringify(characterState())===beforeCharacter&&
      sensePublicPeerGesture(sender,listener).visibility==='absent',
    'Same-instant passive reread cannot train, count or revive a cancelled motion');
    checks.motorInterrupted={paidSeconds:paid,result:structuredClone(listener.lastResult),
      observer:afterCounts[1],poseCleared:true,characterUnchanged:true,sameInstantReadPure:true};
    phase='motor-interrupted';return status();
  }
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
    checks.actorGestureMemory={paidChoiceVisibleAbsence:
      localGesture(listener,sender,'absent').visibility==='absent'&&
      localGesture(sender,listener,'absent').visibility==='absent'};
    const listenerPrediction=localPrediction(listener),senderPrediction=localPrediction(sender);
    require(listenerPrediction.targetAbsent>=1&&senderPrediction.targetAbsent>=1&&
      listenerPrediction.targetPose===0&&senderPrediction.targetPose===0,
    'The paid inspection must settle future visible absence for both actual actors before any public pose');
    checks.actorGesturePrediction={choice:{listener:listenerPrediction,sender:senderPrediction},
      defensiveReadPure:localPredictionReadOnly(listener)};
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
    const listenerLocal=localGesture(listener,sender,'pose'),senderLocal=localGesture(sender,listener,'absent');
    require(listenerLocal.ownActionActive===0&&senderLocal.ownActionActive===1&&
      senderLocal.ownPoseProgress===pose().progress,
    'Each actor must retain only its own action context during the funded pose');
    checks.actorGestureMemory.forward={paidPoseObserved:true,listenerLocal,senderLocal,
      defensiveReadPure:localGestureReadOnly(listener)};
    checks.actorGesturePrediction.forwardMidpoint=localPrediction(listener);
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
      require(sensePublicPeerGesture(copy,sender).visibility==='unknown',
        'An occluded read-only observer copy must see unknown, not visible silence');
      blocked={position:p,reason:observed.reason};
    }
    const farCopy=structuredClone(listener);farCopy.position={x:sender.position.x+401,y:sender.position.y};
    require(sensePublicPeerGesture(farCopy,sender).visibility==='unknown',
      'An out-of-sight read-only observer copy must not infer a pose or silence');
    checks.actorGestureMemory.controlledUnknown=true;
    checks.occlusion={tested:!!blocked,scope:'Read-only observer copy using authoritative world LOS; no main actor relocation',...(blocked||{reason:'No occluded occupiable position in bounded local search'})};
    return status();
  }
  function completeIndication(){
    require(phase==='indicating','Expected indication');until(()=>sender.active!==indicationActive,'Sender indication did not finish');
    indicationProof=successfulDiscoveryActionCompletion(sender,indicationActive);
    require(indicationProof?.type==='indicate_object','No canonical successful sender indication');
    near(indicationProof.worked,1.8,'Paid sender work');near(state.elapsed-baseline.at,1.8,'Real main indication duration');
    require(!pose(),'Completion must remove public cue');
    checks.actorGestureMemory.forwardEndedAsVisibleAbsence=
      localGesture(listener,sender,'absent').visibility==='absent';
    const listenerPrediction=localPrediction(listener),beforePrediction=checks.actorGesturePrediction.choice.listener;
    require(listenerPrediction.targetPose>beforePrediction.targetPose&&
      listenerPrediction.onsets>beforePrediction.onsets&&
      listenerPrediction.validTargets>beforePrediction.validTargets,
    'The funded actual public cue must yield a delayed visible-pose target after the original absent forecast');
    checks.actorGesturePrediction.forward={listener:listenerPrediction,sender:localPrediction(sender),
      defensiveReadPure:localPredictionReadOnly(listener),actualPaidPose:true};
    const snapshot=associationState();
    const replyAvailable=snapshot.pending===1&&snapshot.latest.feedbackStatus==='awaiting-response';
    require(snapshot.observed===1&&snapshot.latest.status==='observed'&&replyAvailable,
      'A completed own-view demonstration must authorize a physical reply attempt');
    checks.replyAvailable=replyAvailable;
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
    phase='indication-complete';return status();
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
    const senderLocal=localGesture(sender,listener,'pose'),listenerLocal=localGesture(listener,sender,'absent');
    require(senderLocal.ownActionActive===0&&listenerLocal.ownActionActive===1&&
      listenerLocal.ownPoseProgress===responsePose().progress,
    'Reply memory must retain each actor’s own action context only');
    checks.actorGestureMemory.reply={paidPoseObserved:true,senderLocal,listenerLocal,
      defensiveReadPure:localGestureReadOnly(sender)};
    checks.actorGesturePrediction.replyMidpoint=localPrediction(sender);
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
    checks.actorGestureMemory.replyEndedAsVisibleAbsence=
      localGesture(sender,listener,'absent').visibility==='absent';
    const senderPrediction=localPrediction(sender),beforePrediction=checks.actorGesturePrediction.forward.sender;
    require(senderPrediction.targetPose>beforePrediction.targetPose&&
      senderPrediction.onsets>beforePrediction.onsets&&
      senderPrediction.validTargets>beforePrediction.validTargets,
    'The funded reciprocal cue must settle a future actor-local pose target independently of feedback');
    checks.actorGesturePrediction.reply={sender:senderPrediction,listener:localPrediction(listener),
      defensiveReadPure:localPredictionReadOnly(sender),actualPaidPose:true};
    const snapshot=associationState(),feedbackStatus=snapshot.latest.feedbackStatus;
    const sampled=feedbackStatus==='matched'||feedbackStatus==='mismatched';
    require(snapshot.observed===1&&snapshot.pending===0&&
      (context.responseScenario===true?sampled&&feedbackStatus==='mismatched':
        context.ambiguityScenario===true?feedbackStatus==='censored'&&snapshot.latest.feedbackReason==='response-ambiguous':
        sampled||feedbackStatus==='censored'),
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
    if(snapshot.latest.feedbackReason==='response-ambiguous'){
      const last=responseAudit.at(-1),trailing=[];
      for(let i=responseAudit.length-1;i>=0&&responseAudit[i].reason==='ambiguous';i--)trailing.push(responseAudit[i]);
      require(last&&state.elapsed-last.at<=fixedStep+1e-8&&
        trailing.length>=Math.ceil(.5/fixedStep)&&
        trailing.every(row=>row.numericResult?.reason==='ambiguous'&&row.localBinding===null&&row.senderFeatures===null),
      'A censored ambiguity must follow a continuous actual paid sender-view interval, never a hypothetical preflight');
      checks.responseAmbiguity={paidVisibleSamples:trailing.length,finalAuditAt:last.at,
        noSenderCrop:true,actualSenderObservation:true};
    }
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
    const beforeSecondListener=structuredClone(partnerState(listener.id,sender.id));
    require(beforeSecondListener.demonstrations===1&&beforeSecondListener.optimizerSteps===1&&
      beforeSecondListener.replayUses===0&&beforeSecondListener.examples.length===1,
      'Second label audit must start from exactly one retained physical demonstration');
    secondStarted=true;
    while(state.elapsed<12.1-1e-8)tick();
    const choice=reference.hooks.optionalAction(listener);
    require(choice?.type==='inspect_object','Second optional listener choice unavailable after cooldown');
    const secondAdmissionCrops=sensor.capture(listener,state);
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
    const afterPaidCharacter=characterState();
    const secondReference=reference.snapshot(),secondEvent=secondReference.latest,
      secondPolicy=partnerState(listener.id,sender.id),secondOwn=secondReference.learners.find(row=>row.agentId===listener.id)?.character,
      finalCrop=sensor.capture(listener,state).get(privateTargetId);
    require(secondEvent.feedbackStatus==='awaiting-response'&&secondReference.pending===1,
      'Second completed demonstration must leave an optional listener response pending');
    require(finalCrop?.pixels?.length===768&&finalCrop.features?.length===CHARACTER_CORE.features&&
      secondEvent.demonstrationPixels?.length===768&&same(finalCrop.features,poolCommunicationPixels(finalCrop.pixels))&&
      same(finalCrop.features,poolCommunicationPixels(secondEvent.demonstrationPixels))&&
      finalCrop.at<=listener.elapsed+1e-8&&listener.elapsed-finalCrop.at<=fixedStep+1e-8,
      'Second final own demonstration must be the fresh actual listener Canvas crop');
    const updated=secondEvent.listenerUpdate===true;
    require(updated||secondEvent.listenerUpdate===false&&secondEvent.correction==='ambiguous-own-view',
      'Second paid demonstration must yield a valid own-view label or explicit visual ambiguity');
    const secondExample=updated?secondPolicy.examples[1]:null;
    const candidateFeatures=secondExample?.candidates??(secondChoiceActive.request.targetId!==privateTargetId?
      [secondChoiceActive.request.targetId,privateTargetId].map(id=>secondAdmissionCrops.get(id)?.features):null);
    const candidatePixels=candidateFeatures?.map(features=>[...secondAdmissionCrops.values()].find(crop=>same(crop.features,features))?.pixels);
    require(!candidateFeatures||candidateFeatures.length===2&&candidateFeatures.every(features=>features?.length===CHARACTER_CORE.features)&&
      candidatePixels.every((pixels,index)=>pixels?.length===768&&
        same(poolCommunicationPixels(pixels),candidateFeatures[index])),
      'Second candidate vectors must come from the original listener Canvas admission');
    const classificationAvailable=!!candidateFeatures;
    const distances=candidateFeatures?.map(features=>Math.sqrt(features.reduce((sum,value,index)=>
      sum+(value-finalCrop.features[index])**2,0)/CHARACTER_CORE.features))??null;
    const classified=candidateFeatures?classifyOwnDemonstration(candidateFeatures,finalCrop.features):null;
    if(updated){
      require(secondExample.message===secondEvent.message&&secondExample.label===classified&&
        distances[classified]<=CHARACTER_CORE.demonstrationMatch&&
        distances[1-classified]-distances[classified]>CHARACTER_CORE.demonstrationGap&&
        secondPolicy.demonstrations===2&&secondPolicy.optimizerSteps===2&&secondPolicy.examples.length===2&&
        secondPolicy.replayUses===1&&secondOwn.uniqueDemonstrations===2&&secondOwn.listenerUpdates===2&&
        !same(secondPolicy.model,beforeSecondListener.model),
      'Exactly two valid physical demonstrations must yield two listener updates and one bounded prior replay');
    }else{
      require(secondPolicy.demonstrations===1&&secondPolicy.optimizerSteps===1&&secondPolicy.examples.length===1&&
        secondPolicy.replayUses===0&&secondOwn.uniqueDemonstrations===1&&secondOwn.listenerUpdates===1&&
        same(secondPolicy.model,beforeSecondListener.model)&&
        secondPolicy.replayState===beforeSecondListener.replayState&&
        same(secondPolicy.examples,beforeSecondListener.examples)&&
        (!candidateFeatures||classified===null),
      'Ambiguous own-view demonstration must leave listener weights, replay and physical counters unchanged');
    }
    checks.secondLabel={scope:'Read-only audit after a second canonical paid indication; no test label enters the learner',
      actualCanvas,secondMessage:secondEvent.message,updated,reason:secondEvent.correction,
      classificationAvailable,
      candidateSource:updated?'retained-own-candidate-example':candidateFeatures?'distinct-choice-and-target-own-crops':'private-pair-unavailable-after-censorship',
      candidateFeatures:candidateFeatures?.map(features=>features.slice())??null,
      candidatePixels:candidatePixels?.map(pixels=>pixels.slice())??null,
      finalOwnFeatures:finalCrop.features.slice(),finalOwnPixels:finalCrop.pixels.slice(),distances,
      classifiedLabel:classified,demonstrations:secondPolicy.demonstrations,
      optimizerSteps:secondPolicy.optimizerSteps,replayUses:secondPolicy.replayUses,
      retainedExamples:secondPolicy.examples.length,
      modelChanged:!same(secondPolicy.model,beforeSecondListener.model),
      replayStateChanged:secondPolicy.replayState!==beforeSecondListener.replayState};
    require(same(characterState(),afterPaidCharacter),
      'Read-only second Canvas label audit cannot sample, train or alter private character state');
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
    require(same(characterState(),afterPaidCharacter),
      'Partly paid response cannot repeat listener learning or update either private model before completion');
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
      beforeCharacter=JSON.stringify(persisted.characterMessages),
      predictionBefore=state.agents.map(actor=>localPrediction(actor));
    require(predictionBefore.every(prediction=>prediction.pending),
      'The saved mid-gesture checkpoint must discard actual pending actor-local forecasts on reopen');
    require(JSON.stringify(reference.snapshot())===before&&JSON.stringify(characterState())===beforeCharacter,
      'Persistence export changed private weights, random states or pending metrics');
    if(!saveCheckpoint())return null;
    const raw=storage.getItem(OZARK_SAVE_KEY);require(raw,'Main save did not write current bytes');
    const document=JSON.parse(raw),canonical=validateCharacterPersistence(persisted);
    require(state.agents.every(actor=>reference.readGestureMemory(actor)?.records.length>0),
      'A paid live gesture must exist only in session memory at checkpoint');
    require(!Object.hasOwn(document,'actorGestureMemory')&&
      document.agents.every(actor=>!Object.hasOwn(actor,'actorGestureMemory'))&&
      document.visualReference.learners.every(owner=>!Object.hasOwn(owner,'gesture'))&&
      document.characterMessages.learners.every(owner=>!Object.hasOwn(owner,'gesture')),
    'Strict ordinary save must exclude transient actor-local gesture rows');
    checks.actorGestureMemory.saveExcluded=true;
    const savedText=JSON.stringify(document);
    require(!/"(?:actorGesturePrediction|actorGesturePredictor|gesturePrediction|gesturePredictor)"/.test(savedText)&&
      state.agents.every((actor,index)=>same(localPrediction(actor),predictionBefore[index])),
    'Ordinary save must exclude session-only prediction state without advancing it');
    checks.actorGesturePrediction.saveExcluded=true;
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
        'Fresh default main state/population and original positions, deliberate optional listener inspect and paid post-choice sender indication with an actual sampled character string. The later optional reply is physically attempted even if Aster cannot uniquely interpret its direction; a paid ambiguous observation, if present, censors sender feedback without erasing listener learning. The ordinary main engine integrates environment/ecology/bodies at 1/60 second. Bounded decision scheduling only; no body hold, injected crops, reward, cohort, scientific-seed sweep or autonomous-adoption claim. A read-only numeric model query uses the original actual own Canvas views but is not a policy action or generalization claim. A second authentic sampled sequence is saved mid-cue to test pending trajectory interruption on reopen.'};
    for(let i=0;i<state.agents.length;i++)require(JSON.stringify(state.agents[i].position)===JSON.stringify(initialPositions[i]),'Fixture moved an actor');
    return result;
  }
  function interrupt(){
    require(['pending-save','pending-response-save'].includes(phase),'Expected pending cue');
    const responseCase=phase==='pending-response-save',actor=responseCase?listener:sender;
    const beforeCharacter=JSON.stringify(characterState()),
      beforePrediction=state.agents.map(owner=>localPrediction(owner));
    const paid=discoveryActionPaidSeconds(actor,pendingActive);
    cancelNpcAction(actor,'NATIVE_FIXTURE_INTERRUPTION');
    require(!(responseCase?responsePose():pose())&&!successfulDiscoveryActionCompletion(actor,pendingActive),
      'Interruption fabricated completion or retained cue');
    reference.afterTick();
    const peer=actor===sender?listener:sender;
    checks.actorGestureMemory.interruptionPublicPoseAbsent=
      sensePublicPeerGesture(peer,actor).visibility==='absent';
    require(checks.actorGestureMemory.interruptionPublicPoseAbsent,
      'Cancelled paid action must immediately stop its public pose');
    require(reference.readGestureMemory(peer).records.some(row=>row.visibility==='pose'),
      'Cancellation at the same clock instant must retain genuinely seen rows until another real sample');
    require(state.agents.every((owner,index)=>same(localPrediction(owner),beforePrediction[index])),
      'A repeated afterTick at the same clock instant must not train or settle a future forecast');
    checks.actorGesturePrediction.sameInstantCancellationPure=true;
    require(JSON.stringify(characterState())===beforeCharacter,
      'Interrupting a pending paid sequence must not update weights, baseline or random states');
    if(responseCase)require(reference.snapshot().latest.feedbackStatus==='censored'&&reference.snapshot().senderFeedback.length===0,
      'Interrupted pending response cannot gain a second feedback event');
    checks.interruption={paidSeconds:paid,result:structuredClone(actor.lastResult),poseCleared:true,
      pendingKind:responseCase?'listener-response':'sender-demonstration'};
    require(paid>0&&paid<1.8,'Interruption must retain genuine partial paid work');phase='interrupted';return status();
  }
  return {project,status,admissionAudit,beginChoice,completeChoice,beginIndication,visible,completeIndication,beginResponse,visibleResponse,completeResponse,
    motorWait,probeFlowingCurrentMotor,beginMotor,visibleMotor,completeFirstMotor,checkpointMotor,interruptMotor,
    inspectAssociation,pendingForSave,pendingResponseForSave,checkpoint,interrupt,
    characterExport:()=>structuredClone(characterState()),
    dispose(){sensor.dispose?.();}};
}

/** A read-only copy of the independently reopened profile cannot acquire the
 * former private motor witness from serialized command fields. */
export async function probeFreeHandReopen(moduleBase,state,serializedActive){
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {publicFreeHandGeometry,ownFreeHandAction,freeHandPaidSeconds}=await use('free-hand-action');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {bindOzarkEcology}=await use('ozark-ecology');
  if(state.agents.some(actor=>actor.active)||serializedActive?.request?.type!=='free_hand')
    throw new Error('Expected a restored idle world and copied motor command');
  const geometry=createOzarkWorldGeometry(),actor=state.agents.find(row=>row.id==='mira');
  bindOzarkEcology(state.environment.ecology,geometry);
  for(const row of state.agents)bindOzarkWorldAgent(row,geometry,state);
  actor.active=structuredClone(serializedActive);
  const copiedPose=publicFreeHandGeometry(actor),copiedOwnAction=ownFreeHandAction(actor),
    copiedPaidSeconds=freeHandPaidSeconds(actor,actor.active);
  actor.active=null;
  if(copiedPose||copiedOwnAction||copiedPaidSeconds||publicFreeHandGeometry(actor))
    throw new Error('Reopened data revived a private paid motor witness');
  return {copiedPose,copiedOwnAction,copiedPaidSeconds,noRevivedAuthority:true};
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
